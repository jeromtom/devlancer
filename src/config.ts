import 'dotenv/config'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

export const config = {
  root,
  dataDir: process.env.DATA_DIR ?? path.join(root, 'data'),
  authDir: process.env.AUTH_DIR ?? path.join(root, 'auth'),
  outDir: process.env.OUT_DIR ?? path.join(root, 'out'),
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '127.0.0.1',
  publicUrl: process.env.PUBLIC_URL ?? '',
  dashboardUser: process.env.DASHBOARD_USER ?? 'jerom',
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
  devToken: process.env.DEV_TOKEN ?? '',
  decideModel: process.env.DECIDE_MODEL ?? 'convaiinnovations/laya',
  textModel: process.env.TEXT_MODEL ?? 'anthropic/claude-sonnet-5-5',
  devinApiKey: process.env.DEVIN_API_KEY ?? '',
  devinOrgId: process.env.DEVIN_ORG_ID ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  demoTemplateRepo: process.env.DEMO_TEMPLATE_REPO ?? '',
  freelancer: {
    name: process.env.FREELANCER_NAME ?? 'Freelancer',
    business: process.env.BUSINESS_NAME ?? '',
    email: process.env.BUSINESS_EMAIL ?? '',
    address: process.env.BUSINESS_ADDRESS ?? '',
    upiId: process.env.UPI_ID ?? '',
    hourlyRate: Number(process.env.HOURLY_RATE ?? 1500),
    skills: process.env.SKILLS ?? 'Web and mobile development',
  },
}
