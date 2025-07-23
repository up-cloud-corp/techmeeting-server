import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { RoomStore, Content } from './Stores'
import { isContentWallpaper } from './ISharedContent'

const config = require('../../config')

/**
 * Interface for room data that will be saved to JSON file
 * This structure defines what information we store permanently
 * ver1.3.0
 */
interface PersistedRoomData {
  roomId: string                    // Original room ID
  roomHash: string                  // SHA-256 hash of the room ID for filename
  properties: Record<string, string> // Room settings and configurations stored as key-value pairs
  wallpaperContents: Content[]       // Array of wallpaper content objects (only wallpapers are saved)
  lastSaved: number                 // Unix timestamp when this data was last saved
}

/**
 * Class responsible for saving and loading room data to/from JSON files
 * This handles persistent storage so rooms can be restored after server restart
 * Uses hash-based file naming
 * ver1.3.0
 */
export class RoomPersistence {
  private saveDir = config.roomPersistence.saveDir

  constructor() {
    if (!fs.existsSync(this.saveDir)) {
      fs.mkdirSync(this.saveDir, { recursive: true })
      console.log(`Created room persistence directory: ${this.saveDir}`)
    }
  }

  /**
   * Generate SHA-256 hash from room ID for safe filename
   * @param roomId - The original room ID
   * @returns SHA-256 hash string
   */
  private generateRoomHash(roomId: string): string {
    return crypto.createHash('sha256').update(roomId, 'utf8').digest('hex')
  }

  /**
   * Get directory path for a room based on hash prefix
   * This distributes files across subdirectories to avoid too many files in one directory
   * @param roomHash - The SHA-256 hash of the room ID
   * @returns Directory path for the room
   */
  private getRoomDirectory(roomHash: string): string {
    // Use first 2 characters of hash for directory distribution
    const prefix = roomHash.substring(0, 2)
    return path.join(this.saveDir, prefix)
  }

  /**
   * Get file path for a room's JSON file
   * @param roomId - The original room ID
   * @returns Full path to the room's JSON file
   */
  private getRoomFilePath(roomId: string): { filePath: string; roomHash: string; directory: string } {
    const roomHash = this.generateRoomHash(roomId)
    const directory = this.getRoomDirectory(roomHash)
    const filePath = path.join(directory, `${roomHash}.json`)
    return { filePath, roomHash, directory }
  }

  /**
   * Save room data to a JSON file
   * Only wallpaper contents are saved (other content types are temporary)
   * @param room - The room store object containing all room data
   */
  async saveRoom(room: RoomStore): Promise<void> {
    try {
      // Extract only wallpaper content from all room contents
      // Other content types (like shared screens) are not saved permanently
      const wallpaperContents = Array.from(room.contents.values())
        .filter(c => isContentWallpaper(c.content))

      const { filePath, roomHash, directory } = this.getRoomFilePath(room.id)

      // Ensure directory exists
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true })
      }

      // Prepare the data structure for JSON storage
      const data: PersistedRoomData = {
        roomId: room.id, // Keep original room ID for reference
        roomHash, // Store hash for verification
        properties: Object.fromEntries(room.properties), // Convert Map to plain object for JSON
        wallpaperContents,
        lastSaved: Date.now(), // Record when this save operation happened
      }

      // Write the data to a JSON file named after the room hash
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2))

      console.log(`Room "${room.id}" saved: ${wallpaperContents.length} wallpapers, ${room.properties.size} properties`)
      console.log(`Saved to: ${filePath}`)
    } catch (error) {
      console.error(`Failed to save room "${room.id}":`, error)
      throw error
    }
  }

  /**
   * Load previously saved room data from JSON file
   * Returns the properties and contents that were saved before
   * @param roomId - The ID of the room to load
   * @returns Object containing properties Map and contents array, or null if file doesn't exist
   */
  loadRoom(roomId: string): {
    properties?: Map<string, string>,
    contents?: Content[]  // Array of Content objects (wallpapers only)
  } | null {
    const { filePath } = this.getRoomFilePath(roomId)

    try {
      // Read and parse the JSON file synchronously
      const data = fs.readFileSync(filePath, 'utf8')
      const roomData: PersistedRoomData = JSON.parse(data)

      // Verify the room ID matches (security check)
      if (roomData.roomId !== roomId) {
        console.warn(`Room ID mismatch: expected "${roomId}", found "${roomData.roomId}" in file ${filePath}`)
        return null
      }

      return {
        properties: new Map(Object.entries(roomData.properties)), // Convert back to Map from plain object
        contents: roomData.wallpaperContents  // Return the saved wallpaper contents
      }
    } catch (error) {
      // If file doesn't exist, that's normal (room was never saved)
      if ((error as any).code !== 'ENOENT') {
        console.error(`Error loading room "${roomId}":`, error)
      }
      return null
    }
  }

  /**
   * Manually clean up old room files that haven't been updated for specified days
   * This method is designed for manual execution by server administrators
   * @param days - Number of days to consider a room as "old" (default: 30 days)
   * @returns Promise that resolves when cleanup is complete
   */
  async cleanupOldRooms(days: number = 30): Promise<void> {
    try {
      const maxAge = days * 24 * 60 * 60 * 1000 // Convert days to milliseconds
      let deletedCount = 0

      console.log(`Starting cleanup: removing rooms not updated for ${days} days...`)

      // Scan all subdirectories for room files
      const subdirs = await fs.promises.readdir(this.saveDir, { withFileTypes: true })

      for (const subdir of subdirs) {
        if (subdir.isDirectory()) {
          const subdirPath = path.join(this.saveDir, subdir.name)
          const files = await fs.promises.readdir(subdirPath)

          for (const file of files) {
            if (file.endsWith('.json')) {
              const filePath = path.join(subdirPath, file)
              const stats = await fs.promises.stat(filePath)

              // Check if file is older than the specified number of days
              if (Date.now() - stats.mtime.getTime() > maxAge) {
                // Read room data to get original room ID for logging
                try {
                  const data = await fs.promises.readFile(filePath, 'utf8')
                  const roomData: PersistedRoomData = JSON.parse(data)

                  await fs.promises.unlink(filePath)
                  deletedCount++
                  console.log(`Deleted old room file: "${roomData.roomId}" (${file})`)
                } catch (readError) {
                  // If we can't read the file, just delete it
                  await fs.promises.unlink(filePath)
                  deletedCount++
                  console.log(`Deleted corrupted room file: ${file}`)
                }
              }
            }
          }

          // Clean up empty directories
          const remainingFiles = await fs.promises.readdir(subdirPath)
          if (remainingFiles.length === 0) {
            await fs.promises.rmdir(subdirPath)
            console.log(`Removed empty directory: ${subdirPath}`)
          }
        }
      }

      if (deletedCount > 0) {
        console.log(`Cleanup completed: removed ${deletedCount} old room files`)
      } else {
        console.log('Cleanup completed: no old room files found')
      }
    } catch (error) {
      console.error('Error during room cleanup:', error)
      throw error
    }
  }
}

// Export a singleton instance for use throughout the application
export const roomPersistence = new RoomPersistence()