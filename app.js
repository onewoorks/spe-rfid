const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Konfigurasi
const CONFIG = {
    host: '192.168.1.192',
    port: 6000,
    timeout: 5000
};

// Buat web server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Simpan data scan
const scannedTags = new Map(); // Map untuk simpan tag dan masa scan
const tagCounts = new Map(); // Map untuk simpan jumlah scan setiap tag

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Socket.IO connection
io.on('connection', (socket) => {
    // Hantar data sedia ada ke browser baru
    socket.emit('update', {
        tags: Array.from(scannedTags.entries()),
        counts: Array.from(tagCounts.entries())
    });
    
    // Handle reset request
    socket.on('reset', () => {
        scannedTags.clear();
        tagCounts.clear();
        io.emit('update', {
            tags: Array.from(scannedTags.entries()),
            counts: Array.from(tagCounts.entries())
        });
    });
});

// Sambung ke RFID Reader
const client = new net.Socket();

client.on('connect', () => {});

client.on('data', (data) => {
    // Simpan data dengan timestamp
    const timestamp = new Date().toLocaleTimeString();
    const tagId = data.toString('hex');
    
    // Update tag data
    scannedTags.set(tagId, timestamp);
    
    // Update tag count
    const currentCount = tagCounts.get(tagId) || 0;
    tagCounts.set(tagId, currentCount + 1);
    
    // Hantar update ke semua browser
    io.emit('update', {
        tags: Array.from(scannedTags.entries()),
        counts: Array.from(tagCounts.entries())
    });
});

client.on('error', (err) => {});

client.on('close', () => {});

// Sambung ke reader
client.connect(CONFIG.port, CONFIG.host);

// Start web server
server.listen(3000, () => {}); 