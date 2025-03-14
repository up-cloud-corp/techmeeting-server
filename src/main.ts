//import "./tracer"; // must come before importing any instrumented module.
import websocket from 'ws'
import https from 'https'
import fs from 'fs'
import debugModule from 'debug'
import {MSConnectMessage, MSPreConnectMessage, MSWorkerStatusMessage} from './MediaServer/MediaMessages'
import {mainServer, sendMSMessage, processPeer, processWorker,
  addConnectListener, addWorkerListener, makeUniqueId} from './MainServer/mainServer'
import {Worker} from './MainServer/types'
import {addDataListener, checkDataLogin, DataSocket, processData} from './DataServer/dataServer'
import {dataServer} from './DataServer/Stores'
import {addPositionListener} from './PositionServer/positionServer'
import {restApp} from './rest'
import {findRoomLoginInfo, startObserveConfigOnGoogleDrive} from './MainServer/mainLogin'
import {consoleDebug, consoleError, consoleLog} from './MainServer/utils'

const err = debugModule('bmMsM:ERROR');
const config = require('../config');

export let messageLoad = 0


//--------------------------------------------------
//  First websocket message handler
//  After connection, this handler judge kind of the websocket and add appropriate handlers.
function onFirstMessage(messageData: websocket.MessageEvent){
  const ws = messageData.target
  const msg = JSON.parse(messageData.data.toString()) as MSConnectMessage
  consoleDebug(`PeerMsg ${msg.type} from ${msg.peer}`)

  if(msg.type === 'preConnect'){
    const msg = JSON.parse(messageData.data.toString()) as MSPreConnectMessage
    // check with google drive json file
    const loginRoom = findRoomLoginInfo(msg.room)
    msg.login = loginRoom?.emailSuffixes?.length ? true : false
    sendMSMessage(msg, ws)
    ws.removeEventListener('message', onFirstMessage)
    addConnectListener(ws)
  }else if (msg.type === 'dataConnect'){
    consoleDebug(`dataConnect checkDataLogin.`)
    checkDataLogin(msg).then(()=>{
      consoleDebug(`dataConnect accepted.`)
      ws.removeEventListener('message', onFirstMessage)
      const ds:DataSocket = {ws, lastReceived:Date.now()}
      addDataListener(ds)
      consoleDebug(`dataConnect accepted and send msg.`)
      ws.send(JSON.stringify(msg))
    }).catch(() => {
      consoleDebug(`dataConnect rejected.`)
      ws.close()
    })
  }else if (msg.type === 'positionConnect'){
    ws.removeEventListener('message', onFirstMessage)
    addPositionListener(ws, msg.peer)
  }else if (msg.type === 'workerAdd'){
    const unique = makeUniqueId(msg.peer, mainServer.workers)
    msg.peer = unique
    sendMSMessage(msg, ws)
    const {type, peer, ...msg_} = msg
    const worker:Worker = {...msg_, id:msg.peer, ws, stat:{load:0}, pongWait: 0}
    mainServer.workers.set(msg.peer, worker)
    consoleLog(`addWorker ${msg.peer}`)
    ws.removeEventListener('message', onFirstMessage)
    addWorkerListener(worker)
  }else if (msg.type === 'workerStatus'){
    const msg = JSON.parse(messageData.data.toString()) as MSWorkerStatusMessage
    let count = 0
    const keys = mainServer.workers.keys();
    for (const key of keys){
      if(key.startsWith(msg.host)){
        count++
      }
    }
    msg.count = count
    msg.status = (count > 0 ? true : false)
    ws.send(JSON.stringify(msg))
    ws.close()
  }else{
    console.warn(`invalid first message ${JSON.stringify(msg)} received.`)
  }
}


function main() {
  Object.assign(global, {d:{mainServer, dataServer}})
  // start https server
  consoleLog('starting wss server');
  try {
    const tls = {
      cert: fs.readFileSync(config.sslCrt),
      key: fs.readFileSync(config.sslKey),
    };
    const httpsServer = https.createServer(tls);
    httpsServer.on('error', (e) => {
      consoleError('https server error,', e.message);
    });

    const wss = new websocket.Server({server: httpsServer})
    httpsServer.on('request', (req, res) =>{
      //console.log(`request: ${JSON.stringify(req.headers)}`)
      restApp(req, res)
    })
    wss.on('connection', ws => {
      consoleDebug(`onConnection() `)
      ws.addEventListener('message', onFirstMessage)
    })

    return new Promise<void>((resolve) => {
      httpsServer.listen(config.httpPort, config.httpIp, () => {
        consoleLog(`server is running and listening on ` +
                    `https://${config.httpIp}:${config.httpPort}`);
        //  Start process to handle queued messages
        const INTERVAL = 100
        setInterval(()=>{
          const start = Date.now()
          let now = start
          while(now - start < INTERVAL/2){
            let processed = processData()
            processed ||= processWorker()
            if (!processed) processed = processPeer()
            if (!processed) break
            now = Date.now()
          }
          messageLoad = (now - start) / INTERVAL
          //utilization = performance.eventLoopUtilization(utilization)
          //console.log(`Process load: ${messageLoad.toPrecision(2)} utilization: ${JSON.stringify(utilization)}`)
        }, INTERVAL)

        if (config.googleOAuth2Config){
          startObserveConfigOnGoogleDrive()   //  Load and observe auth related config file on google drive
        }

        resolve();
      });
    })
  } catch (e :any) {
    if (e.code === 'ENOENT') {
      consoleError('no certificates found (check config.js)');
      consoleError('  could not start https server ... trying http');
    } else {
      err('could not start https server', e);
    }
  }
}

main()
