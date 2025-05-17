const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const ANSWER_MODE = Buffer.from([0x0a, 0x00, 0x35, 0x00, 0x02, 0x01, 0x00, 0x01, 0x00, 0x2a, 0x9f], 'hex');
const INVENTORY = Buffer.from([0x04, 0x00, 0x01, 0xdb, 0x4b], 'hex');

const READER_PORT = 6000;
const READER_IP = "192.168.1.192";

// Used to track the interval for inventory command
let interval;

// Simpan data TID yang unik
const uniqueTids = new Map();

// Buat web server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/read.html');
});

function extractTID(data) {
    try {
        const hexData = data.toString('hex');
        console.log('Raw hex data:', hexData);
        
        // Split data berdasarkan "6200"
        const tidParts = hexData.split('6200');
        console.log('Split parts:', tidParts);
        
        // Proses setiap bahagian yang mengandungi TID
        tidParts.forEach(part => {
            if (part.length >= 24) { // Pastikan panjang cukup untuk TID
                const tid = '6200' + part.substring(0, 24); // Gabungkan semula dengan "6200"
                console.log('Extracted TID:', tid);
                
                if (!uniqueTids.has(tid)) {
                    uniqueTids.set(tid, {
                        count: 1,
                        firstSeen: new Date(),
                        lastSeen: new Date(),
                        raw: hexData
                    });
                } else {
                    const tidData = uniqueTids.get(tid);
                    tidData.count++;
                    tidData.lastSeen = new Date();
                    uniqueTids.set(tid, tidData);
                }
            }
        });
        
        // Hantar semua data TID yang unik
        const uniqueTidData = Array.from(uniqueTids.entries()).map(([tid, data]) => ({
            tid,
            count: data.count,
            firstSeen: data.firstSeen,
            lastSeen: data.lastSeen,
            raw: data.raw
        }));
        
        console.log('Current unique TIDs:', uniqueTidData);
        return uniqueTidData;
    } catch (error) {
        console.error('Error extracting TID:', error);
        return null;
    }
}

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected');
    socket.emit('status', 'Connected to server');
    
    // Hantar semua data TID yang unik
    const uniqueTidData = Array.from(uniqueTids.entries()).map(([tid, data]) => ({
        tid,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        raw: data.raw
    }));
    socket.emit('uniqueTids', uniqueTidData);

    // Handle reset counts
    socket.on('resetCounts', () => {
        console.log('Resetting counts...');
        uniqueTids.clear();
        io.emit('uniqueTids', []);
        socket.emit('status', 'Counts reset');
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Sambung ke pembaca RFID
const reader = new net.Socket();
reader.setEncoding('ascii');
reader.setKeepAlive(true, 60000);

reader.connect(READER_PORT, READER_IP, () => {
    console.log('Connected to RFID reader');
    io.emit('status', 'Connected to RFID reader');
    
    // Switch the reader to the ANSWER_MODE
    console.log('Sending ANSWER_MODE command:', ANSWER_MODE.toString('hex'));
    reader.write(ANSWER_MODE);
    
    // Ask for tag values in the visibility radius
    interval = setInterval(() => {
        console.log('Sending INVENTORY command:', INVENTORY.toString('hex'));
        reader.write(INVENTORY);
    }, 100);
});

reader.on('data', data => {
    const buf = Buffer.from(data, 'ascii');
    const response = buf.toString('hex', 0, buf.length);
    console.log('RESPONSE:', response);
    
    // Proses data untuk dapatkan TID
    const tidData = extractTID(buf);
    if (tidData) {
        console.log('Sending to clients:', tidData);
        io.emit('uniqueTids', tidData);
    }
});

reader.on('error', (err) => {
    console.error('Reader error:', err);
    io.emit('error', 'Reader error: ' + err.message);
    clearInterval(interval);
});

reader.on('close', () => {
    console.log('Reader connection closed');
    io.emit('status', 'Reader connection closed');
    clearInterval(interval);
});

// Start web server
server.listen(3003, () => {
    console.log('Web server running at http://localhost:3003');
});