package dev.tremors.hubagent

import android.service.notification.NotificationListenerService

/**
 * Service vide existant uniquement pour obtenir le droit "Accès aux notifications".
 * Sans cette permission, MediaSessionManager.getActiveSessions() refuse de
 * retourner les sessions actives des autres apps (YouTube, Netflix, Plex, etc.),
 * ce qui nous empêche de stopper une lecture en cours avant d'en lancer une nouvelle.
 *
 * L'utilisateur doit activer manuellement : Paramètres → Apps → Accès aux notifications → Hub Agent
 */
class HubNotificationListener : NotificationListenerService()
