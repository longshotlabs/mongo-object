import MongoObject from './mongo-object.ts'

export {
  appendAffectedKey,
  cleanNulls,
  expandKey,
  extractOp,
  genericKeyAffectsOtherGenericKey,
  isBasicObject,
  keyToPosition,
  makeKeyGeneric,
  reportNulls
} from './util.ts'

export { MongoObject }

export default MongoObject
