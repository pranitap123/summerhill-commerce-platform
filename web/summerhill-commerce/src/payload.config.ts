import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import {
  BoldFeature,
  EXPERIMENTAL_TableFeature,
  IndentFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  UnderlineFeature,
  UnorderedListFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Categories } from '@/collections/Categories'
import { Media } from '@/collections/Media'
import { Pages } from '@/collections/Pages'
import { Users } from '@/collections/Users'
import { parseMailFrom } from '@/collections/Users/auth'
import { Footer } from '@/globals/Footer'
import { Header } from '@/globals/Header'
import { plugins } from './plugins'
import { getConfig } from './server/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    // Payload's default is Gravatar: a third-party request carrying a hash of the staff email, and
    // blocked by our CSP anyway (G6-01).
    avatar: 'default',
    components: {
      // The `BeforeLogin` component renders a message that you see while logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below and the import `BeforeLogin` statement on line 15.
      beforeLogin: ['@/components/BeforeLogin#BeforeLogin'],
      // The `BeforeDashboard` component renders the 'welcome' block that you see after logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below and the import `BeforeDashboard` statement on line 15.
      beforeDashboard: ['@/components/BeforeDashboard#BeforeDashboard'],
    },
    user: Users.slug,
  },
  collections: [Users, Pages, Categories, Media],
  // G6-01: Payload accepts its session cookie only on requests from our own origin (CSRF), and
  // answers cross-origin API calls from nobody else.
  serverURL: getConfig().NEXT_PUBLIC_SERVER_URL,
  csrf: [getConfig().NEXT_PUBLIC_SERVER_URL],
  cors: [getConfig().NEXT_PUBLIC_SERVER_URL],
  // Validated config (G1-02): fails fast instead of connecting with an empty string.
  db: postgresAdapter({
    pool: {
      connectionString: getConfig().DATABASE_URL,
    },
  }),
  editor: lexicalEditor({
    features: () => {
      return [
        UnderlineFeature(),
        BoldFeature(),
        ItalicFeature(),
        OrderedListFeature(),
        UnorderedListFeature(),
        LinkFeature({
          enabledCollections: ['pages'],
          fields: ({ defaultFields }) => {
            const defaultFieldsWithoutUrl = defaultFields.filter((field) => {
              if ('name' in field && field.name === 'url') return false
              return true
            })

            return [
              ...defaultFieldsWithoutUrl,
              {
                name: 'url',
                type: 'text',
                admin: {
                  condition: ({ linkType }) => linkType !== 'internal',
                },
                label: ({ t }) => t('fields:enterURL'),
                required: true,
              },
            ]
          },
        }),
        IndentFeature(),
        EXPERIMENTAL_TableFeature(),
      ]
    },
  }),
  // Account emails (verification, password reset) go through the same SMTP settings as order
  // emails: Mailpit locally (G2-20).
  email: nodemailerAdapter({
    defaultFromAddress: parseMailFrom(getConfig().MAIL_FROM).address,
    defaultFromName: parseMailFrom(getConfig().MAIL_FROM).name,
    transportOptions: {
      host: getConfig().SMTP_HOST,
      port: getConfig().SMTP_PORT,
      secure: getConfig().SMTP_SECURE,
      ...(getConfig().SMTP_USER
        ? { auth: { user: getConfig().SMTP_USER, pass: getConfig().SMTP_PASSWORD ?? '' } }
        : {}),
    },
  }),
  endpoints: [],
  globals: [Header, Footer],
  plugins,
  secret: getConfig().PAYLOAD_SECRET,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // Sharp is now an optional dependency -
  // if you want to resize images, crop, set focal point, etc.
  // make sure to install it and pass it to the config.
  // sharp,
})
