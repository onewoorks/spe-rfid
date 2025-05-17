const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const ANSWER_MODE = Buffer.from([0x0a, 0x00, 0x35, 0x00, 0x02, 0x01, 0x00, 0x01, 0x00, 0x2a, 0x9f], 'hex');
const INVENTORY = Buffer.from([0x04, 0x00, 0x01, 0xdb, 0x4b], 'hex');

const READER_PORT = 6000; // this is default port of the reader
const READER_IP = "192.168.1.192"; // the default IP

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
    res.sendFile(__dirname + '/library.html');
});

// Fungsi untuk kira CRC16
function calculateCRC16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc = crc >> 1;
            }
        }
    }
    return Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF]);
}

// Fungsi untuk mengasingkan TID dari data
function extractTID(data) {
    try {
        const hexData = data.toString('hex');
        console.log('Raw hex data:', hexData);
        
        // Format data: [Header][Length][Data][CRC]
        // Header: 0x20 0x00
        // Length: 0x01
        // Data: [TID bytes]
        // CRC: 2 bytes
        
        // Cari TID dalam data
        // TID biasanya 12 bytes selepas header
        const tidStart = 3; // Selepas header (2 bytes) dan length (1 byte)
        const tidLength = 12; // Panjang TID dalam bytes
        
        if (hexData.length >= (tidStart + tidLength) * 2) {
            const tid = hexData.substring(tidStart * 2, (tidStart + tidLength) * 2);
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
            
            return {
                tid: tid,
                count: uniqueTids.get(tid).count,
                firstSeen: uniqueTids.get(tid).firstSeen,
                lastSeen: uniqueTids.get(tid).lastSeen,
                raw: hexData
            };
        }
        console.log('Data too short to extract TID');
        return null;
    } catch (error) {
        console.error('Error extracting TID:', error);
        return null;
    }
}

// Fungsi untuk hantar command
function sendCommand(command, socket) {
    const client = new net.Socket();
    
    client.on('connect', () => {
        const bytesWritten = client.write(command);
        socket.emit('status', 'Connected to reader');
    });

    client.on('data', (data) => {
        socket.emit('response', data.toString('hex'));
        client.destroy();
    });

    client.on('error', (err) => {
        socket.emit('error', err.message);
        client.destroy();
    });

    client.on('close', () => {
        socket.emit('status', 'Connection closed');
    });

    client.on('timeout', () => {
        socket.emit('error', 'Connection timeout');
        client.destroy();
    });

    client.connect(READER_PORT, READER_IP);
}

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Hantar status sambungan
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

    socket.on('sendCommand', (data) => {
        const { adr, cmd, data: cmdData } = data;
        
        // Kira CRC
        const dataForCRC = Buffer.from([adr, cmd, ...(cmdData || [])]);
        const crc = calculateCRC16(dataForCRC);
        
        // Buat command lengkap
        const command = Buffer.concat([
            Buffer.from([dataForCRC.length + 1]), // Len
            Buffer.from([adr]),  // Adr
            Buffer.from([cmd]),  // Cmd
            ...(cmdData ? [Buffer.from(cmdData)] : []), // Data (optional)
            crc                 // CRC
        ]);
        
        sendCommand(command, socket);
    });

    socket.on('resetCounts', () => {
        uniqueTids.clear();
        io.emit('uniqueTids', []);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start web server
server.listen(3002, () => {
    console.log('Library server running at http://localhost:3002');
    
    // Sambung ke RFID reader
    const reader = new net.Socket();
    reader.setEncoding('ascii');
    reader.setKeepAlive(true, 60000);

    reader.connect(READER_PORT, READER_IP, () => {
        console.log('Connected to RFID reader');
        io.emit('status', 'Connected to RFID reader');
        
        // Switch the reader to the ANSWER_MODE
        reader.write(ANSWER_MODE);
        
        // Ask for tag values in the visibility radius
        interval = setInterval(() => {
            reader.write(INVENTORY);
        }, 100);
    });

    reader.on('data', data => {
        console.log('Received data from reader:', data); // Debug log
        const tidData = extractTID(data);
        if (tidData) {
            console.log('Extracted TID data:', tidData); // Debug log
            io.emit('rfidData', tidData);
            
            // Hantar semua data TID yang unik
            const uniqueTidData = Array.from(uniqueTids.entries()).map(([tid, data]) => ({
                tid,
                count: data.count,
                firstSeen: data.firstSeen,
                lastSeen: data.lastSeen,
                raw: data.raw
            }));
            io.emit('uniqueTids', uniqueTidData);
        }
    });

    reader.on('error', (err) => {
        console.error('Reader error:', err);
        io.emit('error', 'Reader error: ' + err.message);
    });

    reader.on('close', () => {
        console.log('Reader connection closed');
        io.emit('status', 'Reader connection closed');
        clearInterval(interval);
    });
});