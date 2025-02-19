import { type RouteRecordRaw } from 'vue-router'
import { type _Router } from './type-extensions/router'

export type {
  UseDataLoader,
  UseDataLoaderInternals,
  UseDataLoaderResult,
  DataLoaderContextBase,
  DataLoaderEntryBase,
  DefineDataLoaderOptionsBase,
  DefineLoaderFn,
  _DataMaybeLazy,
} from './data-fetching/createDataLoader'

// new data fetching
export { defineBasicLoader } from './data-fetching/defineLoader'
export type {
  DataLoaderContext,
  DefineDataLoaderOptions,
} from './data-fetching/defineLoader'
export {
  DataLoaderPlugin,
  NavigationResult,
} from './data-fetching/navigation-guard'
export type {
  DataLoaderPluginOptions,
  SetupLoaderGuardOptions,
  _DataLoaderRedirectResult,
} from './data-fetching/navigation-guard'

export type {
  DataLoaderColadaEntry,
  DataColadaLoaderContext,
  DefineDataColadaLoaderOptions,
  UseDataLoaderColada,
  UseDataLoaderColadaResult,
} from './data-fetching/defineColadaLoader'
export { defineColadaLoader } from './data-fetching/defineColadaLoader'

// NOTE: for tests only
// export * from './data-fetching/defineQueryLoader'

/**
 * Defines properties of the route for the current page component.
 *
 * @param route - route information to be added to this page
 * @deprecated - use `definePage` instead
 */
export const _definePage = (route: DefinePage) => route
/**
 * Defines properties of the route for the current page component.
 *
 * @param route - route information to be added to this page
 */
export const definePage = (route: DefinePage) => route

/**
 * Merges route records.
 *
 * @internal
 *
 * @param main - main route record
 * @param routeRecords - route records to merge
 * @returns merged route record
 */
export function _mergeRouteRecord(
  main: RouteRecordRaw,
  ...routeRecords: Partial<RouteRecordRaw>[]
): RouteRecordRaw {
  // @ts-expect-error: complicated types
  return routeRecords.reduce((acc, routeRecord) => {
    const meta = Object.assign({}, acc.meta, routeRecord.meta)
    const alias: string[] = ([] as string[]).concat(
      acc.alias || [],
      routeRecord.alias || []
    )

    // TODO: other nested properties
    // const props = Object.assign({}, acc.props, routeRecord.props)

    Object.assign(acc, routeRecord)
    acc.meta = meta
    acc.alias = alias
    return acc
  }, main)
}

/**
 * Type to define a page. Can be augmented to add custom properties.
 */
export interface DefinePage
  extends Partial<
    Omit<RouteRecordRaw, 'children' | 'components' | 'component'>
  > {}
