#!/usr/bin/env ts-node

import { roomPersistence } from '../DataServer/RoomPersistence'

/**
 * Standalone script for manual room cleanup
 * Usage:
 *   npm run cleanup-rooms        (cleanup rooms older than 30 days)
 *   npm run cleanup-rooms 7      (cleanup rooms older than 7 days)
 *   npm run cleanup-rooms 60     (cleanup rooms older than 60 days)
 */
async function main() {
  try {
    // Get days from command line argument, default to 30
    const days = process.argv[2] ? parseInt(process.argv[2]) : 30

    if (isNaN(days) || days <= 0) {
      console.error('Error: Please provide a valid number of days (positive integer)')
      console.log('Usage: npm run cleanup-rooms [days]')
      console.log('Example: npm run cleanup-rooms 7')
      process.exit(1)
    }

    console.log('=== Room Cleanup Tool ===')
    console.log(`Target: rooms not updated for ${days} days`)
    console.log('Starting cleanup process...\n')

    // Execute the cleanup
    await roomPersistence.cleanupOldRooms(days)

    console.log('\n=== Cleanup completed successfully ===')
    process.exit(0)

  } catch (error) {
    console.error('\n=== Cleanup failed ===')
    console.error('Error:', error)
    process.exit(1)
  }
}

// Run the script if executed directly
if (require.main === module) {
  main()
} 