package expo.modules.smsreader

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsReaderModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    Events("onIncomingSms")

    Function("isSmsScannerAvailable") {
      true
    }

    AsyncFunction("readRecentSms") { days: Int, limit: Int ->
      readRecentSmsInternal(days, limit)
    }

    Function("startIncomingListener") {
      startIncomingListenerInternal()
    }

    Function("stopIncomingListener") {
      stopIncomingListenerInternal()
    }

    OnDestroy {
      stopIncomingListenerInternal()
    }
  }

  private fun getContext(): Context? {
    return appContext.reactContext?.applicationContext
  }

  private fun hasPermission(context: Context, permission: String): Boolean {
    return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
  }

  private fun readRecentSmsInternal(days: Int, limit: Int): List<Map<String, Any>> {
    val context = getContext() ?: return emptyList()
    if (!hasPermission(context, Manifest.permission.READ_SMS)) {
      return emptyList()
    }

    val safeDays = if (days > 0) days else 7
    val safeLimit = if (limit > 0) limit else 10
    val since = System.currentTimeMillis() - safeDays.toLong() * 86_400_000L

    val uri = Uri.parse("content://sms/inbox")
    val projection = arrayOf("_id", "address", "body", "date")
    val selection = "date > ?"
    val selectionArgs = arrayOf(since.toString())
    val sortOrder = "date DESC LIMIT $safeLimit"

    val results = ArrayList<Map<String, Any>>()
    var cursor: android.database.Cursor? = null

    try {
      cursor = context.contentResolver.query(uri, projection, selection, selectionArgs, sortOrder)
      if (cursor != null) {
        val idIndex = cursor.getColumnIndex("_id")
        val addressIndex = cursor.getColumnIndex("address")
        val bodyIndex = cursor.getColumnIndex("body")
        val dateIndex = cursor.getColumnIndex("date")

        while (cursor.moveToNext() && results.size < safeLimit) {
          val id = if (idIndex >= 0) cursor.getString(idIndex) ?: "" else ""
          val address = if (addressIndex >= 0) cursor.getString(addressIndex) ?: "Unknown" else "Unknown"
          val body = if (bodyIndex >= 0) cursor.getString(bodyIndex) ?: "" else ""
          val date = if (dateIndex >= 0) cursor.getLong(dateIndex) else System.currentTimeMillis()

          if (id.isNotEmpty() && body.isNotEmpty()) {
            results.add(
              mapOf(
                "id" to id,
                "address" to address,
                "body" to body,
                "date" to date
              )
            )
          }
        }
      }
    } catch (_: Exception) {
    } finally {
      try {
        cursor?.close()
      } catch (_: Exception) {
      }
    }

    return results
  }

  private fun startIncomingListenerInternal() {
    val context = getContext() ?: return
    if (!hasPermission(context, Manifest.permission.RECEIVE_SMS)) {
      return
    }
    if (receiver != null) {
      return
    }

    val broadcastReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
          return
        }

        try {
          val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
          if (messages.isNullOrEmpty()) {
            return
          }

          val bodyBuilder = StringBuilder()
          var address = "Unknown"
          var timestamp = System.currentTimeMillis()

          for (sms in messages) {
            val smsBody = sms.messageBody
            if (!smsBody.isNullOrEmpty()) {
              bodyBuilder.append(smsBody)
            }
            val sender = sms.originatingAddress
            if (!sender.isNullOrEmpty()) {
              address = sender
            }
            timestamp = sms.timestampMillis
          }

          val body = bodyBuilder.toString()
          if (body.isEmpty()) {
            return
          }

          sendEvent(
            "onIncomingSms",
            mapOf(
              "id" to "incoming-$timestamp-${address.hashCode()}",
              "address" to address,
              "body" to body,
              "date" to timestamp
            )
          )
        } catch (_: Exception) {
        }
      }
    }

    val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
    filter.priority = 999

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(broadcastReceiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        context.registerReceiver(broadcastReceiver, filter)
      }
      receiver = broadcastReceiver
    } catch (_: Exception) {
      receiver = null
    }
  }

  private fun stopIncomingListenerInternal() {
    val context = getContext() ?: return
    val currentReceiver = receiver ?: return
    try {
      context.unregisterReceiver(currentReceiver)
    } catch (_: Exception) {
    }
    receiver = null
  }
}
