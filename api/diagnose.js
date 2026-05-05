import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AiService {
  static const String _baseUrl = 'https://driveshift-ai-backend.vercel.app';

  // =========================
  // TEXT DIAGNOSIS
  // =========================
  static Future<String> diagnoseCarIssue({
    required String issue,
    required bool isEnglish,
    required List<Map<String, String>> answers,
  }) async {
    final url = Uri.parse('$_baseUrl/api/diagnose');

    try {
      final vehicleProfile = await _loadVehicleProfile();

      final enhancedAnswers = _mergeVehicleProfileWithAnswers(
        answers: answers,
        vehicleProfile: vehicleProfile,
      );

      final body = {
        'app': 'DriveShift',
        'issue': issue.trim(),
        'language': isEnglish ? 'en' : 'es',
        'vehicleProfile': vehicleProfile,
        'answers': enhancedAnswers,
        'mode': 'diagnostic_flow',
        'timestamp': DateTime.now().toIso8601String(),
      };

      final response = await http
          .post(
            url,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 35));

      if (response.statusCode != 200) {
        throw AiServiceException(
          isEnglish
              ? 'DriveShift could not reach the diagnostic engine.'
              : 'DriveShift no pudo conectar con el motor de diagnóstico.',
        );
      }

      final decoded = jsonDecode(response.body);
      final result = _extractResult(decoded);

      if (result.isEmpty || _isBadFallback(result)) {
        throw AiServiceException(
          isEnglish
              ? 'DriveShift needs a bit more detail before continuing.'
              : 'DriveShift necesita un poco más de información.',
        );
      }

      return _cleanOutput(result);
    } on AiServiceException {
      rethrow;
    } catch (_) {
      throw AiServiceException(
        isEnglish
            ? 'Connection issue. Please try again.'
            : 'Problema de conexión. Inténtalo de nuevo.',
      );
    }
  }

  // =========================
  // IMAGE AI
  // =========================
  static Future<String> analyzeWarningLightImage({
    required File imageFile,
    required bool isEnglish,
    String? detectedText,
  }) async {
    final url = Uri.parse('$_baseUrl/api/diagnose-image');

    try {
      final vehicleProfile = await _loadVehicleProfile();

      final bytes = await imageFile.readAsBytes();
      final base64Image = base64Encode(bytes);

      final response = await http
          .post(
            url,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'app': 'DriveShift',
              'type': 'vision',
              'image': base64Image,
              'detectedText': detectedText ?? '',
              'language': isEnglish ? 'en' : 'es',
              'vehicleProfile': vehicleProfile,
              'mode': 'diagnostic_flow',
            }),
          )
          .timeout(const Duration(seconds: 55));

      if (response.statusCode != 200) {
        throw AiServiceException(
          isEnglish
              ? 'DriveShift could not analyze the image.'
              : 'DriveShift no pudo analizar la imagen.',
        );
      }

      final decoded = jsonDecode(response.body);
      final result = _extractResult(decoded);

      if (result.isEmpty || _isBadFallback(result)) {
        throw AiServiceException(
          isEnglish
              ? 'DriveShift needs a clearer image.'
              : 'DriveShift necesita una imagen más clara.',
        );
      }

      return _cleanOutput(result);
    } on AiServiceException {
      rethrow;
    } catch (_) {
      throw AiServiceException(
        isEnglish
            ? 'Connection issue. Please try again.'
            : 'Problema de conexión. Inténtalo de nuevo.',
      );
    }
  }

  // =========================
  // VEHICLE MEMORY
  // =========================
  static Future<Map<String, String>> _loadVehicleProfile() async {
    final prefs = await SharedPreferences.getInstance();

    return {
      'year': prefs.getString('vehicle_year')?.trim() ?? '',
      'make': prefs.getString('vehicle_make')?.trim() ?? '',
      'model': prefs.getString('vehicle_model')?.trim() ?? '',
      'mileage': prefs.getString('vehicle_mileage')?.trim() ?? '',
    };
  }

  static List<Map<String, String>> _mergeVehicleProfileWithAnswers({
    required List<Map<String, String>> answers,
    required Map<String, String> vehicleProfile,
  }) {
    final enhanced = List<Map<String, String>>.from(answers);

    final hasVehicleInfo =
        vehicleProfile.values.any((value) => value.trim().isNotEmpty);

    if (hasVehicleInfo) {
      enhanced.insert(0, {
        'question': 'Vehicle profile',
        'answer': _vehicleProfileText(vehicleProfile),
      });
    }

    return enhanced;
  }

  static String _vehicleProfileText(Map<String, String> profile) {
    final year =
        profile['year']?.isNotEmpty == true ? profile['year']! : 'Unknown year';
    final make =
        profile['make']?.isNotEmpty == true ? profile['make']! : 'Unknown make';
    final model = profile['model']?.isNotEmpty == true
        ? profile['model']!
        : 'Unknown model';
    final mileage = profile['mileage']?.isNotEmpty == true
        ? '${profile['mileage']} miles'
        : 'Unknown mileage';

    return '$year $make $model, $mileage';
  }

  // =========================
  // EXTRACT RESULT
  // =========================
  static String _extractResult(dynamic decoded) {
    if (decoded is! Map) return '';

    return (decoded['result'] ??
            decoded['diagnosis'] ??
            decoded['message'] ??
            decoded['text'] ??
            '')
        .toString()
        .trim();
  }

  // =========================
  // QUALITY GUARD
  // =========================
  static bool _isBadFallback(String text) {
    final lower = text.toLowerCase().trim();

    if (lower.isEmpty) return true;

    final badPhrases = [
      'connection issue',
      'please try again',
      'no internet',
      'incomplete response',
      'error de conexión',
      'inténtalo de nuevo',
    ];

    return badPhrases.any(lower.contains);
  }

  // =========================
  // CLEAN OUTPUT
  // =========================
  static String _cleanOutput(String input) {
    return input
        .replaceAll('**', '')
        .replaceAll('__', '')
        .replaceAll('`', '')
        .replaceAll(RegExp(r'\n{3,}'), '\n\n')
        .trim();
  }
}

// =========================
// AI SERVICE EXCEPTION
// =========================
class AiServiceException implements Exception {
  final String message;

  AiServiceException(this.message);

  @override
  String toString() => message;
}
