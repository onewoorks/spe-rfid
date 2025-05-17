const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Konfigurasi pembaca RFID
const READER_IP = "192.168.31.192";
const READER_PORT = 6000;

// Command untuk pembaca RFID
const ANSWER_MODE = Buffer.from([0x0a, 0x00, 0x35, 0x00, 0x02, 0x01, 0x00, 0x01, 0x00, 0x2a, 0x9f], 'hex');
const INVENTORY = Buffer.from([0x04, 0x00, 0x01, 0xdb, 0x4b], 'hex');

// Simpan data TID
const tags = new Map();

// Used to track the interval for inventory command
let intervalId = null; // Rename interval to intervalId

// Buat web server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/simple.html');
});

// Fungsi untuk dapatkan TID dari data
function getTIDs(data) {
    const hex = data.toString('hex');
    // console.log('Raw data:', hex); // Log ini sudah dibuang
    
    // Cari semua TID dalam data
    const tids = [];
    let pos = 0;
    const searchPattern = 'e280'; // Cari permulaan TID 'e280'
    const epcLengthHex = 20; // Panjang EPC/TID dalam karakter hex (seperti dalam contoh E280xxxxxxxxxxxxxxxxxxxx)
    const crcLengthHex = 4; // Panjang CRC dalam karakter hex (2 bytes)
    const totalExpectedLengthHex = searchPattern.length + epcLengthHex + crcLengthHex; // 4 + 20 + 4 = 28

    while (pos < hex.length) {
        // Cari permulaan TID (e280)
        const start = hex.indexOf(searchPattern, pos);
        if (start === -1) break;

        // Pastikan ada cukup data selepas permulaan untuk EPC dan CRC
        if (start + totalExpectedLengthHex <= hex.length) {
            // Ambil keseluruhan blok (e280 + EPC + CRC)
            const fullBlock = hex.substring(start, start + totalExpectedLengthHex);
            
            // Ekstrak hanya EPC/TID
            const tid = fullBlock.substring(searchPattern.length, searchPattern.length + epcLengthHex);

            // Pastikan hanya mengandungi karakter hex (optional, tapi bagus untuk kebersihan data)
            if (/^[0-9a-f]+$/.test(tid)) {
                 // console.log('Found TID:', tid); // Log ini sudah dibuang
                 tids.push(tid);
            }
            
            pos = start + totalExpectedLengthHex; // Lompat ke hujung blok yang diproses
        } else {
            // Jika tidak cukup data, berhenti mencari
            break;
        }
    }
    
    // console.log('All TIDs found:', tids); // Log ini sudah dibuang
    return tids;
}

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected, ID:', socket.id);
    
    // Hantar data sedia ada
    const tagData = Array.from(tags.entries()).map(([tid, data]) => ({
        tid,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen
    }));
    socket.emit('tags', tagData);
    
    // Reset counts
    socket.on('reset', () => {
        console.log('Reset event received from client', socket.id);
        tags.clear();
        io.emit('tags', []);
        io.emit('status', 'Counts reset');
    });

    // Handle start scan
    socket.on('startScan', () => {
        console.log('startScan event received from client', socket.id);
        if (intervalId === null) {
            console.log('Starting new scan interval...');
            io.emit('status', 'Scanning...');
            intervalId = setInterval(() => {
                // console.log('Sending INVENTORY command...'); // Optional: re-add for debug if needed
                reader.write(INVENTORY);
            }, 100);
        } else {
             console.log('Scan interval already running.');
             io.emit('status', 'Already scanning.');
        }
    });

    // Handle stop scan
    socket.on('stopScan', () => {
        console.log('stopScan event received from client', socket.id);
        if (intervalId !== null) {
            console.log('Clearing scan interval...');
            clearInterval(intervalId);
            intervalId = null;
            io.emit('status', 'Scan stopped.');
        } else {
            console.log('No scan interval to stop.');
            io.emit('status', 'Not currently scanning.');
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected, ID:', socket.id);
    });
});

// Sambung ke pembaca RFID
const reader = new net.Socket();
reader.setKeepAlive(true, 60000);

reader.connect(READER_PORT, READER_IP, () => {
    console.log('Connected to RFID reader');
    io.emit('status', 'Connected to RFID reader. Ready to scan.');
    
    // Switch to ANSWER_MODE - this only needs to be sent once after connection
    reader.write(ANSWER_MODE);
    
    // **DO NOT start inventory here. Wait for startScan command from client.**
    // setInterval(() => {
    //     reader.write(INVENTORY);
    // }, 100);
});

// Handle data dari pembaca
reader.on('data', data => {
    const tids = getTIDs(data);
    
    tids.forEach(tid => {
        if (!tags.has(tid)) {
            tags.set(tid, {
                count: 1,
                firstSeen: new Date(),
                lastSeen: new Date()
            });
        } else {
            const tag = tags.get(tid);
            tag.count++;
            tag.lastSeen = new Date();
        }
    });
    
    // Hantar data ke semua client
    const tagData = Array.from(tags.entries()).map(([tid, data]) => ({
        tid,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen
    }));
    io.emit('tags', tagData);
});

// Handle errors
reader.on('error', (err) => {
    console.error('Reader error:', err);
    io.emit('status', 'Error: ' + err.message);
    if (intervalId !== null) { // Clear interval on error
        clearInterval(intervalId);
        intervalId = null;
        console.log('Interval cleared due to error.');
    }
});

reader.on('close', () => {
    console.log('Reader connection closed');
    io.emit('status', 'Reader disconnected');
    if (intervalId !== null) { // Clear interval on close
        clearInterval(intervalId);
        intervalId = null;
        console.log('Interval cleared due to connection close.');
    }
});

// Start server
server.listen(3003, () => {
    console.log('Server running at http://localhost:3003');
}); 