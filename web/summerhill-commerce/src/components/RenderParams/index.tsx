import { Suspense } from 'react'

import type { Props } from './Component'

import { RenderParamsComponent } from './Component'

export const RenderParams: React.FC<Props> = (props) => {
  return (
    <Suspense fallback={null}>
      <RenderParamsComponent {...props} />
    </Suspense>
  )
}
