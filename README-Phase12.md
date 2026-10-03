# DivyaShilla Phase 12

Open README.md first. Then follow docs/AZURE-SETUP.md with your technical helper. This package prepares production hosting and instructions; it has not deployed or created Azure resources.

Local: Node 24, npm ci in each application folder, retain existing private backend configuration/data/uploads, run npm run dev in both folders and open http://localhost:5173.

Production: Linux App Service serves compiled frontend and API together; PostgreSQL Flexible Server and a private Blob container hold data. Use the reviewed production settings and separate database owner/runtime accounts. No new migrations or business features.

Validation and limitations are in docs/VALIDATION.md. Backup/restore, first accounts, final checklist and non-technical troubleshooting guides are included.
