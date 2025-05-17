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

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/command.html');
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

// Fungsi untuk hantar command
function sendCommand(command, socket) {
    console.log('Connecting to reader at', CONFIG.host, 'port', CONFIG.port);
    console.log('Sending command:', command.toString('hex'));
    
    const client = new net.Socket();
    
    client.on('connect', () => {
        console.log('Connected to reader');
        const bytesWritten = client.write(command);
        console.log('Bytes written:', bytesWritten);
        socket.emit('status', 'Connected to reader');
    });

    client.on('data', (data) => {
        console.log('Response received:', data.toString('hex'));
        socket.emit('response', data.toString('hex'));
        client.destroy();
    });

    client.on('error', (err) => {
        console.error('Connection error:', err.message);
        socket.emit('error', err.message);
        client.destroy();
    });

    client.on('close', () => {
        console.log('Connection closed');
        socket.emit('status', 'Connection closed');
    });

    client.on('timeout', () => {
        console.log('Connection timeout');
        socket.emit('error', 'Connection timeout');
        client.destroy();
    });

    client.connect(CONFIG.port, CONFIG.host);
}

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Browser connected');
    
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
});

// Start web server
server.listen(3001, () => {
    console.log('Command server running at http://localhost:3001');
}); 