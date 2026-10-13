/**
 * DEV ONLY Login Modal
 * Embeds YouTube Music web sign-in inside a WebView, reads native HttpOnly session cookies,
 * and passes them to backend auth.setSessionFromCookies().
 */

import React, { useState } from 'react';
import { Modal, View, Text, Button, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import CookieManager from '@react-native-cookies/cookies';
import type { Backend } from '@/backend/services';

interface LoginModalProps {
  visible: boolean;
  backend: Backend;
  onClose: () => void;
  onSuccess: () => void;
  onReportError: (msg: string) => void;
}

export function LoginModal({
  visible,
  backend,
  onClose,
  onSuccess,
  onReportError,
}: LoginModalProps) {
  const [currentUrl, setCurrentUrl] = useState<string>('https://music.youtube.com');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const handleNavStateChange = async (navState: WebViewNavigation) => {
    setCurrentUrl(navState.url);

    // If navigated back to YouTube Music after Google account sign-in
    if (
      navState.url.includes('music.youtube.com') &&
      !navState.url.includes('accounts.google.com') &&
      !isProcessing
    ) {
      try {
        const cookies = await CookieManager.get('https://music.youtube.com');
        if (cookies && (cookies['SAPISID'] || cookies['__Secure-3PAPISID'] || cookies['__Secure-PAPISID'])) {
          setIsProcessing(true);
          const cookieMap: Record<string, string> = {};
          for (const [name, cookieObj] of Object.entries(cookies)) {
            if (cookieObj && cookieObj.value) {
              cookieMap[name] = cookieObj.value;
            }
          }

          const setRes = await backend.setSessionFromCookies(cookieMap);
          if (setRes.ok) {
            onSuccess();
          } else {
            onReportError(`Auth establishment failed: ${setRes.error.message}`);
          }
        }
      } catch (err) {
        onReportError(`Cookie extraction error: ${String(err)}`);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>[DEV ONLY] YouTube Music Sign-In</Text>
          <Button title="Close" onPress={onClose} color="#d32f2f" />
        </View>
        <Text style={styles.urlBar} numberOfLines={1}>
          {currentUrl}
        </Text>
        {isProcessing && (
          <View style={styles.loadingBanner}>
            <ActivityIndicator size="small" color="#ffffff" />
            <Text style={styles.loadingText}>Extracting session cookies...</Text>
          </View>
        )}
        <WebView
          source={{
            uri: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F',
          }}
          onNavigationStateChange={handleNavStateChange}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          style={styles.webview}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            onReportError(`WebView Error: ${nativeEvent.description} (code: ${nativeEvent.code})`);
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            if (nativeEvent.statusCode >= 400) {
              onReportError(
                `WebView HTTP ${nativeEvent.statusCode} at "${nativeEvent.url}": ${nativeEvent.description}`,
              );
            }
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 10,
    backgroundColor: '#212121',
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  urlBar: {
    fontSize: 11,
    color: '#555555',
    backgroundColor: '#eeeeee',
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontFamily: 'monospace',
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: '#2e7d32',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 12,
    marginLeft: 8,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
  },
});
