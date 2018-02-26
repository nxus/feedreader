
import {BaseModel} from 'nxus-storage'

export default BaseModel.extend({
  identity: 'feedreader-feedread',
  connection: 'default',
  attributes: {
    url: { type: 'string'},
    meta: { type: 'json'}
  }
})
