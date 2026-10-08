import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api'
import type { SpanExporter } from '@opentelemetry/sdk-trace-base'

export interface TraceCarrier {
  traceparent?: string
  tracestate?: string
}

const tracer = () => trace.getTracer('grocery-marketplace')

export function currentTraceCarrier(): TraceCarrier | null {
  const carrier: TraceCarrier = {}
  propagation.inject(context.active(), carrier)
  return carrier.traceparent ? carrier : null
}

export async function inSpan<T>(
  name: string,
  options: { kind?: SpanKind; attributes?: Attributes; parent?: TraceCarrier | null },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const ctx = options.parent?.traceparent
    ? propagation.extract(context.active(), options.parent)
    : context.active()
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    ctx,
    async (span) => {
      try {
        return await fn(span)
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message })
        throw err
      } finally {
        span.end()
      }
    },
  )
}

export { SpanKind }

let started = false

export async function startTracing(service: string, exporter?: SpanExporter): Promise<boolean> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (started || (!exporter && !endpoint)) return started
  const [{ NodeTracerProvider }, base, { resourceFromAttributes }, { registerInstrumentations }] =
    await Promise.all([
      import('@opentelemetry/sdk-trace-node'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/instrumentation'),
    ])
  const [{ PgInstrumentation }, { UndiciInstrumentation }] = await Promise.all([
    import('@opentelemetry/instrumentation-pg'),
    import('@opentelemetry/instrumentation-undici'),
  ])
  const processor = exporter
    ? new base.SimpleSpanProcessor(exporter)
    : new base.BatchSpanProcessor(
        new (await import('@opentelemetry/exporter-trace-otlp-http')).OTLPTraceExporter(),
      )
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? `grocery-${service}`,
    }),
    spanProcessors: [processor],
  })
  provider.register()
  registerInstrumentations({
    instrumentations: [
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new UndiciInstrumentation(),
    ],
  })
  started = true
  return true
}
