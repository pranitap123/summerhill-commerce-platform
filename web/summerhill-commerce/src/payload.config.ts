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
import { Products } from '@/collections/Products'
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

    avatar: 'default',
    components: {

      beforeLogin: ['@/components/BeforeLogin#BeforeLogin'],

      beforeDashboard: ['@/components/BeforeDashboard#BeforeDashboard'],
    },
    user: Users.slug,
  },
  collections: [Users, Pages, Categories, Products, Media],

  serverURL: getConfig().NEXT_PUBLIC_SERVER_URL,
  csrf: [getConfig().NEXT_PUBLIC_SERVER_URL],
  cors: [getConfig().NEXT_PUBLIC_SERVER_URL],

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

})
