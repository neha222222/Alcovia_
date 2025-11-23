# Deployment Guide - Step by Step

## Step 1: Push Code to GitHub

### Option A: Using GitHub Desktop (Easiest)
1. Download [GitHub Desktop](https://desktop.github.com)
2. Open GitHub Desktop
3. Click "Add" → "Add Existing Repository"
4. Select the `alcovia` folder
5. Click "Publish repository"
6. Name it `alcovia-intervention-engine`
7. Make it **Public** (required for free tier)
8. Click "Publish Repository"

### Option B: Using Terminal
```bash
cd /Users/neha/Documents/neha/alcovia

# Initialize git
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Alcovia Intervention Engine"

# Create repo on GitHub (via web) then:
git remote add origin https://github.com/YOUR_USERNAME/alcovia-intervention-engine.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy Backend on Railway 

### Why Railway?
- Built-in PostgreSQL (no separate setup)
- Automatic deployments from GitHub
- Generous free tier ($5 credit/month)
- Zero configuration needed

### Deployment Steps

1. **Go to [Railway](https://railway.app)**
   - Click "Start a New Project"
   - Choose "Deploy from GitHub repo"
   - Select your `alcovia-intervention-engine` repository

2. **Configure Backend Service**
   - Railway will detect Node.js automatically
   - Click "Add variables"
   - Add these environment variables:
     ```
     PORT=3001
     NODE_ENV=production
     ```
   - **Important**: Set Root Directory to `server`
     - Go to Settings → Build → Root Directory → Enter `server`

3. **Add PostgreSQL Database**
   - Click "New" → "Database" → "Add PostgreSQL"
   - Railway will automatically:
     - Create a PostgreSQL instance
     - Set `DATABASE_URL` environment variable
     - Connect it to your backend

4. **Wait for Deployment** (2-3 minutes)
   - Railway will build and deploy
   - You'll get a URL like: `https://alcovia-backend-production.up.railway.app`

5. **Test Backend**
   - Open: `https://YOUR-BACKEND-URL/api/health`
   - Should see: `{"status":"ok","message":"Server is running"}`

6. **Copy Backend URL** - you'll need it for frontend!

### Important: Enable Public Networking
- Go to Settings → Networking
- Click "Generate Domain" to get public URL

---

## Step 3: Deploy Frontend on Vercel

### Why Vercel?
- Made for React/Vite apps
- Automatic builds and deployments
- Global CDN for fast loading
- Perfect for this project

### Deployment Steps

1. **Go to [Vercel](https://vercel.com)**
   - Click "Add New" → "Project"
   - Import your `alcovia-intervention-engine` repository

2. **Configure Build Settings**
   - Framework Preset: **Vite**
   - Root Directory: **client** (important!)
   - Build Command: `npm run build`
   - Output Directory: `dist`

3. **Add Environment Variable**
   - Click "Environment Variables"
   - Add:
     ```
     Name: VITE_API_URL
     Value: https://YOUR-RAILWAY-BACKEND-URL
     ```
   - Replace with your actual Railway backend URL from Step 2

4. **Deploy**
   - Click "Deploy"
   - Wait 1-2 minutes
   - You'll get a URL like: `https://alcovia-intervention-engine.vercel.app`

5. **Test Frontend**
   - Open your Vercel URL
   - You should see the Alcovia Focus app
   - Try starting a timer - it should connect to backend

### Troubleshooting
If you see connection errors:
- Check VITE_API_URL is correct (include https://)
- Ensure backend is running on Railway
- Check browser console for errors

---

## Step 4: Setup n8n Workflow 

### Why n8n Cloud?
- No server hosting needed
- Free tier includes 5,000 executions/month
- Built-in email and webhook support

### Setup Steps

1. **Create n8n Cloud Account**
   - Go to [n8n.io/cloud](https://n8n.io/cloud)
   - Sign up for free
   - Verify email

2. **Create New Workflow**
   - Click "New workflow"
   - Name it "Student Intervention Workflow"

3. **Import Our Workflow**
   
   **Option A: Manual Setup (Recommended)**
   
   Add these nodes in order:
   
   **Node 1: Webhook**
   - Add node → Trigger → Webhook
   - HTTP Method: POST
   - Path: `student-intervention`
   - Copy the webhook URL (you'll need this!)
   
   **Node 2: Send Email**
   - Add node → Email Send (SMTP)
   - Configure your email service:
   
   **For Gmail:**
   ```
   SMTP Host: smtp.gmail.com
   SMTP Port: 465
   SSL/TLS: Yes
   User: your-email@gmail.com
   Password: Your App Password (see below)
   ```
   
   **To get Gmail App Password:**
   - Go to Google Account → Security
   - Enable 2-Factor Authentication
   - Search "App Passwords"
   - Generate password for "Mail"
   - Copy the 16-character password
   
   Email template:
   ```
   To: mentor@alcovia.com (or your email)
   Subject: Student Intervention Required
   Body:
   Student: {{$json.student_name}}
   Quiz Score: {{$json.quiz_score}}/10
   Focus Time: {{$json.focus_minutes}} min
   
   Click to assign task:
   [We'll add this link in next step]
   ```
   
   **Node 3: Wait**
   - Add node → Flow → Wait
   - Resume: Webhook
   - Copy the resume webhook URL
   
   **Node 4: HTTP Request**
   - Add node → HTTP Request
   - Method: POST
   - URL: `https://YOUR-RAILWAY-BACKEND-URL/api/assign-intervention`
   - Body:
   ```json
   {
     "student_id": "{{$json.student_id}}",
     "remedial_task": "{{$json.remedial_task}}",
     "mentor_email": "{{$json.mentor_email}}",
     "intervention_id": "{{$json.intervention_id}}"
   }
   ```

4. **Save and Activate**
   - Click "Save"
   - Toggle "Active" (top right)

5. **Copy Webhook URLs**
   - Copy the Webhook Trigger URL
   - Copy the Wait Webhook URL (for mentor response)

---

## Step 5: Connect Everything

### Update Backend with n8n Webhook

1. **Go to Railway Dashboard**
   - Open your backend service
   - Go to "Variables"
   - Add new variable:
     ```
     N8N_WEBHOOK_URL=https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/student-intervention
     ```
   - Railway will automatically redeploy

2. **Update Frontend CORS** (if needed)
   - Go to Railway → Backend → Variables
   - Add:
     ```
     CLIENT_URL=https://your-vercel-app.vercel.app
     ```

### Create Mentor Response Form

Create a simple HTML file to test mentor responses:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Assign Remedial Task</title>
    <style>
        body { font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px; }
        input, textarea { width: 100%; padding: 10px; margin: 10px 0; }
        button { background: #667eea; color: white; padding: 15px 30px; border: none; cursor: pointer; }
    </style>
</head>
<body>
    <h1>🎓 Assign Remedial Task</h1>
    <form action="YOUR_N8N_WAIT_WEBHOOK_URL" method="POST">
        <label>Student ID:</label>
        <input type="text" name="student_id" value="123" required>
        
        <label>Intervention ID:</label>
        <input type="text" name="intervention_id" required>
        
        <label>Remedial Task:</label>
        <textarea name="remedial_task" rows="4" required>Read Chapter 4 and complete all exercises. Focus on understanding the core concepts.</textarea>
        
        <label>Your Email:</label>
        <input type="email" name="mentor_email" value="mentor@alcovia.com" required>
        
        <button type="submit">Assign Task to Student</button>
    </form>
</body>
</html>
```

Save this as `mentor-form.html` and:
- Deploy it to Vercel (drag & drop)
- Or use a tool like [CodePen](https://codepen.io)
- Replace `YOUR_N8N_WAIT_WEBHOOK_URL` with actual URL

---

## Step 6: Test the Complete Flow 

### Test Case: Failed Check-in → Intervention

1. **Open your Vercel app**
   ```
   https://your-app.vercel.app
   ```

2. **Simulate a failing student:**
   - Click "Start Focus Session"
   - Wait 10 seconds (or let timer run)
   - Stop timer (should show < 60 minutes)
   - Enter quiz score: **5** (less than 8)
   - Click "Submit Daily Check-in"

3. **Expected Results:**
   - App should show LOCKED screen
   - Message: "Waiting for mentor..."
   - You should receive an email notification
   - Check n8n dashboard - workflow should be running

4. **Mentor Assigns Task:**
   - Open the mentor form HTML
   - Fill in:
     - Student ID: `123`
     - Intervention ID: `1` (check email or database)
     - Task: "Read Chapter 4"
     - Email: your email
   - Click "Assign Task"

5. **Expected Results:**
   - Student app should INSTANTLY unlock (WebSocket!)
   - Should show Remedial Task screen
   - Display your assigned task
   - Show "Mark Complete" button

6. **Complete Task:**
   - Click "Mark Complete"
   - Should return to ACTIVE state
   - Can start new focus session

### Test Case: Successful Check-in

1. Start timer, let it run 61+ minutes
2. Enter quiz score **8 or higher**
3. Submit
4. Should show "On Track" status
5. No intervention triggered

---

## Update Your README

After deployment, update `README.md` with your URLs:


1. **Intro** (15 sec)
   - "Hi, I'm [name], here's my Alcovia assignment"

2. **Architecture Overview** (30 sec)
   - Show README.md architecture diagram
   - Explain the flow

3. **Failed Check-in Demo** (2 min)
   - Open live app
   - Submit failing scores
   - Show app locking
   - Show email received
   - Show n8n workflow running

4. **Mentor Assignment** (1 min)
   - Use mentor form
   - Show instant unlock in app
   - Show remedial task

5. **Complete Task** (30 sec)
   - Mark task complete
   - Return to active state

6. **Bonus Features** (1 min)
   - Show tab switching detection
   - Explain WebSocket real-time updates
   - Show code snippets

7. **Outro** (15 sec)
   - Thank reviewers
   - Show GitHub repo

---

## Common Issues & Fixes

### Backend Deployment Issues

**Issue**: Database connection error
```
Error: connect ECONNREFUSED
```
**Fix**: 
- Railway automatically sets DATABASE_URL
- Check Variables tab - DATABASE_URL should be set
- Format: `postgresql://user:pass@host:port/dbname`

**Issue**: Health check failing
**Fix**:
- Make sure Root Directory is set to `server`
- Check logs: Railway Dashboard → Deployments → View Logs

### Frontend Deployment Issues

**Issue**: Blank page or "Cannot connect to server"
**Fix**:
- Verify VITE_API_URL is set correctly
- Must include `https://`
- Redeploy after changing env vars

**Issue**: CORS error
**Fix**:
- Add CLIENT_URL to Railway backend variables
- Should match your Vercel URL

### n8n Issues

**Issue**: Webhook not receiving data
**Fix**:
- Check workflow is Active (toggle in top right)
- Test webhook with curl:
```bash
curl -X POST https://your-n8n-url/webhook/student-intervention \
  -H "Content-Type: application/json" \
  -d '{"student_id":"123","quiz_score":5,"focus_minutes":30}'
```

**Issue**: Email not sending
**Fix**:
- Gmail: Use App Password, not regular password
- Enable "Less secure app access" (if using old method)
- Try SendGrid instead (free tier)

---


