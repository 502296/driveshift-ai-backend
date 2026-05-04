import 'package:flutter/material.dart';

import 'screens/questions_screen.dart';
import 'services/ai_service.dart';
import 'screens/diagnosis_result_screen.dart';

class DiagnosisScreen extends StatefulWidget {
  final String issue;
  final bool isEnglish;

  const DiagnosisScreen({
    super.key,
    required this.issue,
    required this.isEnglish,
  });

  @override
  State<DiagnosisScreen> createState() => _DiagnosisScreenState();
}

class _DiagnosisScreenState extends State<DiagnosisScreen> {
  final TextEditingController problemController = TextEditingController();
  bool loading = false;

  String? originalProblem;
  String? mechanicQuestion;

  bool get isFreeAsk => widget.issue == 'free';

  @override
  void dispose() {
    problemController.dispose();
    super.dispose();
  }

  Future<void> _diagnoseFreeText() async {
    FocusScope.of(context).unfocus();

    final text = problemController.text.trim();
    if (text.isEmpty || loading) return;

    setState(() => loading = true);

    originalProblem ??= text;

    final answers = <Map<String, String>>[
      {
        'question': 'User described the vehicle problem',
        'answer': originalProblem!,
      },
    ];

    if (mechanicQuestion != null) {
      answers.add({
        'question': mechanicQuestion!,
        'answer': text,
      });
    }

    final result = await AiService.diagnoseCarIssue(
      issue: originalProblem!,
      isEnglish: widget.isEnglish,
      answers: answers,
    );

    if (!mounted) return;

    final needsFollowUp = _needsFollowUp(result);
    final nextQuestion = _extractNextQuestion(result);

    setState(() => loading = false);

    if (needsFollowUp && nextQuestion.isNotEmpty && mechanicQuestion == null) {
      setState(() {
        mechanicQuestion = nextQuestion;
        problemController.clear();
      });
      return;
    }

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DiagnosisResultScreen(
          result: result,
          isEnglish: widget.isEnglish,
        ),
      ),
    );
  }

  bool _needsFollowUp(String result) {
    final lower = result.toLowerCase();
    return lower.contains('diagnosis status: follow_up') ||
        lower.contains('more details are needed before a final diagnosis');
  }

  String _extractNextQuestion(String result) {
    final match = RegExp(
      r'What to do next:\s*([\s\S]*?)(?=\n\s*When to stop driving:|$)',
      caseSensitive: false,
    ).firstMatch(result);

    return match?.group(1)?.trim() ?? '';
  }

  @override
  Widget build(BuildContext context) {
    final data = _getIssueData(widget.issue);

    return Scaffold(
      backgroundColor: const Color(0xFF030405),
      appBar: AppBar(
        backgroundColor: const Color(0xFF030405),
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Text(
          widget.isEnglish ? data.titleEn : data.titleEs,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 8, 22, 24),
          child: isFreeAsk ? _buildFreeAsk(data) : _buildGuidedDiagnosis(data),
        ),
      ),
    );
  }

  Widget _buildFreeAsk(IssueData data) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.isEnglish ? data.descriptionEn : data.descriptionEs,
          style: const TextStyle(
            color: Color(0xFFB7BDC5),
            fontSize: 17,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 24),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF0B0D10),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: const Color(0xFF2B3138)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.psychology_rounded,
                color: Colors.white,
                size: 46,
              ),
              const SizedBox(height: 16),
              Text(
                mechanicQuestion == null
                    ? (widget.isEnglish
                        ? "Describe the problem in your own words."
                        : "Describe el problema con tus propias palabras.")
                    : (widget.isEnglish
                        ? "DriveShift has one follow-up question."
                        : "DriveShift tiene una pregunta más."),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                mechanicQuestion ??
                    (widget.isEnglish
                        ? "Example: My car shakes when I accelerate and sometimes smells like fuel."
                        : "Ejemplo: Mi coche vibra cuando acelero y a veces huele a gasolina."),
                style: const TextStyle(
                  color: Color(0xFF9AA3AD),
                  fontSize: 14.5,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: problemController,
                maxLines: 6,
                minLines: 4,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  height: 1.4,
                ),
                cursorColor: Colors.white,
                decoration: InputDecoration(
                  hintText: mechanicQuestion == null
                      ? (widget.isEnglish
                          ? "Tell DriveShift what is happening..."
                          : "Dile a DriveShift qué está pasando...")
                      : (widget.isEnglish
                          ? "Answer the mechanic question..."
                          : "Responde la pregunta del mecánico..."),
                  hintStyle: const TextStyle(
                    color: Color(0xFF777F8A),
                  ),
                  filled: true,
                  fillColor: const Color(0xFF11151A),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(22),
                    borderSide: const BorderSide(color: Color(0xFF303842)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(22),
                    borderSide: const BorderSide(color: Color(0xFF303842)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(22),
                    borderSide: const BorderSide(
                      color: Colors.white,
                      width: 1.3,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const Spacer(),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: Colors.black,
            minimumSize: const Size(double.infinity, 58),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
            ),
          ),
          onPressed: loading ? null : _diagnoseFreeText,
          child: loading
              ? const SizedBox(
                  width: 23,
                  height: 23,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.6,
                    color: Colors.black,
                  ),
                )
              : Text(
                  mechanicQuestion == null
                      ? (widget.isEnglish
                          ? "Ask DriveShift"
                          : "Preguntar a DriveShift")
                      : (widget.isEnglish
                          ? "Send Answer"
                          : "Enviar respuesta"),
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
        ),
      ],
    );
  }

  Widget _buildGuidedDiagnosis(IssueData data) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.isEnglish ? data.descriptionEn : data.descriptionEs,
          style: const TextStyle(
            color: Color(0xFFB7BDC5),
            fontSize: 17,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 26),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            color: const Color(0xFF0B0D10),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: const Color(0xFF2B3138)),
          ),
          child: Column(
            children: [
              Icon(
                data.icon,
                color: Colors.white,
                size: 54,
              ),
              const SizedBox(height: 16),
              Text(
                widget.isEnglish
                    ? "DriveShift will ask a few simple questions before analysis."
                    : "DriveShift hará algunas preguntas simples antes del análisis.",
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFFD5DEE9),
                  fontSize: 16,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        const Spacer(),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: Colors.black,
            minimumSize: const Size(double.infinity, 56),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
            ),
          ),
          onPressed: () {
            FocusScope.of(context).unfocus();
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => QuestionsScreen(
                  issue: widget.issue,
                  isEnglish: widget.isEnglish,
                ),
              ),
            );
          },
          child: Text(
            widget.isEnglish ? "Start Diagnosis" : "Iniciar diagnóstico",
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    );
  }
}

class IssueData {
  final String titleEn;
  final String titleEs;
  final String descriptionEn;
  final String descriptionEs;
  final IconData icon;

  const IssueData({
    required this.titleEn,
    required this.titleEs,
    required this.descriptionEn,
    required this.descriptionEs,
    required this.icon,
  });
}

IssueData _getIssueData(String issue) {
  switch (issue) {
    case 'free':
      return const IssueData(
        titleEn: "Ask DriveShift",
        titleEs: "Preguntar a DriveShift",
        descriptionEn:
            "Type any car problem in your own words. DriveShift will ask what matters first, then guide the diagnosis.",
        descriptionEs:
            "Escribe cualquier problema del auto. DriveShift preguntará lo importante primero y luego guiará el diagnóstico.",
        icon: Icons.psychology_rounded,
      );

    case 'start':
      return const IssueData(
        titleEn: "Car won’t start",
        titleEs: "El coche no arranca",
        descriptionEn:
            "This could be related to the battery, starter, fuel system, or ignition. DriveShift will guide you step by step.",
        descriptionEs:
            "Esto podría estar relacionado con batería, arranque, combustible o encendido. DriveShift te guiará paso a paso.",
        icon: Icons.power_settings_new_rounded,
      );

    case 'shaking':
      return const IssueData(
        titleEn: "Shaking or vibration",
        titleEs: "Vibración",
        descriptionEn:
            "Shaking can come from tires, misfires, mounts, suspension, brakes, or drivetrain problems.",
        descriptionEs:
            "La vibración puede venir de llantas, fallos del motor, soportes, suspensión, frenos o transmisión.",
        icon: Icons.vibration_rounded,
      );

    case 'warning':
      return const IssueData(
        titleEn: "Warning light",
        titleEs: "Luz de advertencia",
        descriptionEn:
            "A dashboard warning light can point to different systems. DriveShift will help narrow it down.",
        descriptionEs:
            "Una luz de advertencia puede indicar diferentes sistemas. DriveShift ayudará a reducir las causas.",
        icon: Icons.warning_amber_rounded,
      );

    case 'other':
      return const IssueData(
        titleEn: "Guided diagnosis",
        titleEs: "Diagnóstico guiado",
        descriptionEn:
            "Choose what you notice first. DriveShift will ask simple questions before analysis.",
        descriptionEs:
            "Elige primero lo que notas. DriveShift hará preguntas simples antes del análisis.",
        icon: Icons.auto_awesome_rounded,
      );

    default:
      return const IssueData(
        titleEn: "Vehicle diagnosis",
        titleEs: "Diagnóstico del vehículo",
        descriptionEn:
            "Describe what is happening and DriveShift will help analyze the issue.",
        descriptionEs:
            "Describe lo que ocurre y DriveShift ayudará a analizar el problema.",
        icon: Icons.directions_car_rounded,
      );
  }
}
