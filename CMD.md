cd /d D:\Pro_Grade_ERP_System\backend
npm install
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run build
npm start

For development mode with automatic reload:
cd /d D:\Pro_Grade_ERP_System\backend
npm run start:dev

Test health API from another CMD window
curl http://localhost:3000/api/v1/health

Expected response:
{"status":"ok","database":"ok"}

You can also open this in a browser:
curl -i http://localhost:3000/api/v1/users
curl -i http://localhost:3000/api/v1/roles
curl -i http://localhost:3000/api/v1/permissions
curl -i http://localhost:3000/api/v1/students
curl -i http://localhost:3000/api/v1/homework
curl -i http://localhost:3000/api/v1/announcements