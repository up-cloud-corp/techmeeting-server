import {ISharedContent, SharedContentInfo, isContentWallpaper} from './ISharedContent'
import {Pose2DMap, clonePose2DMap, cloneV2} from './coordinates'
import {BMMessage as Message, ObjectArrayMessage} from './DataMessage'
import {MessageType} from './DataMessageType'
import {ObjectArrayMessageTypes, StringArrayMessageTypes} from './DataMessageType'
import { roomPersistence } from './RoomPersistence'
import websocket from 'ws'

const config = require('../../config')

// Constants for persistence timing (now using config values)
// const PERSISTENCE_DEBOUNCE_DELAY = 5000 // 5 seconds delay for debounced saves

export interface Content{
  content: ISharedContent,
  timeUpdate: number,
  timeUpdateInfo: number
}
export interface ParticipantSent{
  participant: ParticipantStore,
  timeSent: number
  position: [number, number]
}
function createParticipantSent(p: ParticipantStore, timeSent: number): ParticipantSent|undefined{
  if (!p.pose){
    console.error(`Participant ${p.id} does not have pose.`)
    return
  }else{
    return {
      participant: p,
      timeSent,
      position: cloneV2(p.pose.position)
    }
  }
}
function updateParticipantSent(sent: ParticipantSent, updateTime: number){
  if (sent.participant.pose){
    sent.position = cloneV2(sent.participant.pose.position)
    sent.timeSent = updateTime
  }else{
    console.error(`No pose for ${sent.participant.id} in updateParticipantSent().`)
  }
}

export interface ContentSent{
  content: Content,
  timeSent: number
  pose: Pose2DMap
  size: [number, number]
}
export function updateContentSent(sent: ContentSent){
  if (sent.timeSent < sent.content.timeUpdate){
    sent.timeSent = sent.content.timeUpdate
    sent.pose = clonePose2DMap(sent.content.content.pose)
    sent.size = cloneV2(sent.content.content.size)
    return true
  }else{
    return false
  }
}
export function createContentSent(c: Content):ContentSent{
  return {content:c, timeSent:c.timeUpdate,
    pose:clonePose2DMap(c.content.pose), size:cloneV2(c.content.size)}
}

export interface ContentInfoSent{
  content: SharedContentInfo,
  timeSent: number
}
export interface ParticipantState{
  type: string
  updateTime: number
  value: string
}
export class ParticipantStore {
  id: string
  socket:websocket.WebSocket
  //  participant related
  onStage = false
  storedMessages = new Map<string, Message>()   //  key=type
  participantStates = new Map<string, ParticipantState>() //  key=type
  timeSentStates = new Map<string, number>()
  messagesTo:Message[] = []                     //

  //  participant pose
  pose?: Pose2DMap
  participantsSent:Map<ParticipantStore, ParticipantSent> = new Map()

  //  mouse related
  mouseMessageValue?: string
  mousePos?: [number,number]
  mouseUpdateTime = 0
  mousesSent:Map<ParticipantStore, ParticipantSent> = new Map()

  //  contents related
  contentsSent:Map<Content, ContentSent> = new Map()
  contentsInfoSent:Map<Content, ContentInfoSent> = new Map()

  //  add message to send
  pushOrUpdateMessage(msg: Message){
    const found = this.messagesTo.findIndex(m => m.t === msg.t && m.p === msg.p)
    if (found >= 0){
      //  same message type is already in the queue (messagesTo).
      if (ObjectArrayMessageTypes.has(msg.t)){
        //  Merge new messages to existing one.
        const values = JSON.parse(this.messagesTo[found].v) as ObjectArrayMessage[]
        const toAdds = JSON.parse(msg.v) as ObjectArrayMessage[]
        for (const toAdd of toAdds){
          const idx = values.findIndex(v => v.id === toAdd.id)
          if (idx >= 0){
            values[idx] = toAdd
          }else{
            values.push(toAdd)
          }
        }
      }else if(StringArrayMessageTypes.has(msg.t)){
        //  Merge new messages to existing one.
        const values = JSON.parse(this.messagesTo[found].v) as string[]
        const toAdds = JSON.parse(msg.v) as string[]
        for (const toAdd of toAdds){
          const idx = values.findIndex(v => v === toAdd)
          if (idx >= 0){
            values[idx] = toAdd
          }else{
            values.push(toAdd)
          }
        }
      }else{
        //  Replace existing message by new one.
        this.messagesTo[found] = msg  //  update
      }
    }else{
      //  add new message.
      this.messagesTo.push(msg)     //  push
    }
  }

  sendMessages(){ //  Client wait response of the server. Server must always send packet.
    try{
      if (this.socket.readyState === websocket.OPEN){
        this.socket.send(JSON.stringify(this.messagesTo))
        //.catch(reason => {
        //  console.error(`this.socket.send() failed by reason=${reason}`)
        //})
      }
    }
    catch(e){
      console.error(e)
    }
    this.messagesTo = []
  }
  //  Push states of a participant to send to this participant.
  pushStatesToSend(p: ParticipantStore){
    const sent = this.participantsSent.get(p)
    const sentTime = sent?.timeSent
    let latest = sentTime ? sentTime : 0
    p.participantStates.forEach((s, mt) => {
      if (!sentTime || s.updateTime > sentTime){
        this.pushOrUpdateMessage({t:mt, v:s.value, p:p.id})
        latest = Math.max(latest, s.updateTime)
      }
    })
    if (sent) {
      updateParticipantSent(sent, latest)
    }else{
      const newSent = createParticipantSent(p, latest)
      if (newSent){ this.participantsSent.set(p, newSent) }
    }
  }
  pushMouseToSend(p:ParticipantStore, sent?:ParticipantSent){
    if (p.mousePos && p.mouseMessageValue){
      if (!sent){ sent = this.mousesSent.get(p) }
      if (sent){
        if (p.mouseUpdateTime <= sent.timeSent) return
        sent.timeSent = p.mouseUpdateTime
        sent.position = cloneV2(p.mousePos)
      }else{
        sent = {timeSent:p.mouseUpdateTime, position:cloneV2(p.mousePos),  participant:p}
        this.mousesSent.set(p, sent)
      }
      this.pushOrUpdateMessage({t:MessageType.PARTICIPANT_MOUSE, v:p.mouseMessageValue, p:sent.participant.id})
    }
  }

  constructor(id:string, socket:websocket.WebSocket){
    this.id = id
    this.socket = socket
  }
}

export interface ChatMessage {
  from: string;   // Sender's ID
  name: string;   // Sender's name
  avatarUrl: string; // Sender's avatar image URL
  to: string;     // Recipient's ID (empty string if sent to all)
  text: string;   // Message content
  ts: number;     // Timestamp
  colors: string[]; // Sender's color information
}

export class RoomStore {
  id: string                                //  room id
  tick = 1
  participantsMap = new Map<string, ParticipantStore>()  //  key=source pid
  participants:ParticipantStore[] = []
  properties = new Map<string, string>()    //  room properties
  contents = new Map<string, Content>()     //  room contents
  chatMessages: ChatMessage[] = [];         // Property to store chat history

  // Persistence related properties
  //  saveTimer is used to debounce the saveToStorage() call.
  //  lastModified is used to check if the data is modified.
  // ver1.3.0
  saveTimer?: NodeJS.Timeout
  lastModified = 0  // Will be set when data is actually modified

  constructor(roomId: string){
    this.id = roomId
    // Load persistent data on startup
    this.loadFromStorage()
  }

  // Load data from storage
  private loadFromStorage() {
    try {
      const savedData = roomPersistence.loadRoom(this.id)
      if (savedData) {
        // Restore properties
        if (savedData.properties) {
          this.properties = savedData.properties
        }

        // Restore wallpaper contents
        if (savedData.contents) {
          for (const content of savedData.contents) {
            this.contents.set(content.content.id, content)
          }
        }

        console.log(`Room ${this.id} restored from storage`)
      }
    } catch (error) {
      console.error(`Failed to load room ${this.id} from storage:`, error)
    }
  }

  // Call this method when data is modified (save with debounce)
  markModified() {
    this.lastModified = Date.now()

    // Save after 5 seconds (debounce to avoid frequent saves)
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveToStorage()
    }, config.roomPersistence.debounceDelay)
  }

  // Save data to storage
  private async saveToStorage() {
    try {
      await roomPersistence.saveRoom(this)
    } catch (error) {
      console.error(`Failed to save room ${this.id}:`, error)
    }
  }

  // Set room property (triggers persistence only if wallpaper content exists)
  setProperty(key: string, value: string) {
    this.properties.set(key, value)
    
    // Only save if wallpaper content exists
    if (this.hasWallpaperContent()) {
      this.markModified()
    }
  }

  // Delete room property (triggers persistence only if wallpaper content exists)
  deleteProperty(key: string) {
    this.properties.delete(key)
    
    // Only save if wallpaper content exists
    if (this.hasWallpaperContent()) {
      this.markModified()
    }
  }

  // Check if room has wallpaper content
  private hasWallpaperContent(): boolean {
    return Array.from(this.contents.values()).some(c => isContentWallpaper(c.content))
  }

  // Update room content (triggers persistence only for wallpapers)
  updateContent(content: Content) {
    this.contents.set(content.content.id, content)

    // Save only when wallpaper content is updated
    if (isContentWallpaper(content.content)) {
      this.markModified()
    }
  }

  getParticipant(pid: string, sock: websocket.WebSocket){
    const found = this.participantsMap.get(pid)
    if (found) { return found }
    const created = new ParticipantStore(pid, sock)
    this.participantsMap.set(pid, created)
    this.participants.push(created)
    return created
  }
  onParticipantLeft(left: ParticipantStore){
    //  remove screen contents from the participant left.
    const screens = Array.from(this.contents.values())
      .filter((c => (c.content.type === 'screen' || c.content.type === 'camera')
        && left.id === c.content.id.substr(0, left.id.length)))
      .map(c => c.content.id)
    this.removeContents(screens, left)

    //  remove the participant left.
    this.participantsMap.delete(left.id)
    const idx = this.participants.findIndex(p => p === left)
    this.participants.splice(idx, 1)
    if (this.participantsMap.size === 0){
      if (this.participants.length){
        console.error(`Participants ${this.participants.map(p => p.id)} remains.`)
      }

      // Remove contents other than wallpapers
      this.contents.forEach(c => {
        if (!isContentWallpaper(c.content)) {
          this.contents.delete(c.content.id)
        }
      })

      console.log(`Room ${this.id} closed.`)
    }
  }

  removeContents(cids: string[], from: ParticipantStore){
    //   delete contents
    const toRemove:Content[] = []
    for(const cid of cids){
      const c = this.contents.get(cid)
      if (c){
        toRemove.push(c)
        this.contents.delete(cid)
      }
    }
    for(const participant of this.participants){
      //  remove content from contentsSent of all participants.
      for(const c of toRemove){
        participant.contentsSent.delete(c)
        participant.contentsInfoSent.delete(c)
      }
      //  remove content from CONTENT_INFO_UPDATE and CONTENT_UPDATE_REQUEST
      const msgs:Message[] = []
      const msgInfo = participant.messagesTo.find(m => m.t === MessageType.CONTENT_INFO_UPDATE)
      if (msgInfo){ msgs.push(msgInfo)}
      const msgContent = participant.messagesTo.find(m => m.t === MessageType.CONTENT_UPDATE_REQUEST)
      if (msgContent){ msgs.push(msgContent)}
      for (const msg of msgs){
        const value = JSON.parse(msg.v) as {id:string}[]
        for(const remove of toRemove){
          const idx = value.findIndex(c => c.id === remove.content.id)
          if (idx >= 0){
            value.splice(idx, 1)
          }
        }
      }
    }
    //  forward remove request to all remote participants
    const msg:Message = {t: MessageType.CONTENT_REMOVE_REQUEST, r:this.id, v: JSON.stringify(cids)}
    for(const participant of this.participants){
      //  forward remove message (need to remove ContentInfoList)
      if (participant !== from){
        participant.pushOrUpdateMessage(msg)
      }
    }
  }
  addChatMessage(msg: Message, from:ParticipantStore): void {
    // console.log(`addChatMessage: ${msg.v}`)
    const chatMessage = JSON.parse(msg.v) as ChatMessage;
    chatMessage.from = from.id;
    this.chatMessages.push(chatMessage);
  }
}

export interface PandR{
  participant: ParticipantStore
  room: RoomStore
}
export class Rooms{
  rooms = new Map<string, RoomStore>()
  sockMap = new Map<websocket.WebSocket, PandR>()
  sendCount = 0;
  getOrCreate(name: string) {
    const found = this.rooms.get(name)
    if (found){
      if (roomPersistence.loadRoom(name)) {
        found.markModified()
      }
      return found
    }
    const create = new RoomStore(name)
    create.markModified()
    this.rooms.set(name, create)
    console.log(`Room ${name} created. Rooms:`, Array.from(this.rooms.keys()))
    return create
  }
  clear(){
    this.rooms = new Map()
  }
}
export const rooms = new Rooms();

type MessageHandler = (msg: Message, participant: ParticipantStore, room: RoomStore) => void
export const messageHandlers = new Map<string, MessageHandler>()

export const dataServer = {
  messageHandlers,
  rooms,
}
