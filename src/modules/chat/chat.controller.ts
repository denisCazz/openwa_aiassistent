import { Controller, Get, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { SessionService } from '../session/session.service';

@ApiTags('chats')
@Controller('sessions/:sessionId/chats')
export class ChatController {
  constructor(private readonly sessionService: SessionService) {}

  @Get()
  @ApiOperation({ summary: 'List WhatsApp conversations for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'List of chats sorted by most recent activity' })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  async listChats(@Param('sessionId') sessionId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started');
    }
    return engine.getChats();
  }

  @Get(':chatId/messages')
  @ApiOperation({ summary: 'Get live message history from WhatsApp for a chat' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'chatId', description: 'Chat ID (e.g. 628xxx@c.us or group@g.us)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max messages (default 30)' })
  @ApiResponse({ status: 200, description: 'Messages sorted oldest to newest' })
  async getChatMessages(
    @Param('sessionId') sessionId: string,
    @Param('chatId') chatId: string,
    @Query('limit') limit?: string,
  ) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started');
    }
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 30;
    const messages = await engine.getChatMessages(chatId, parsedLimit);
    return { messages, total: messages.length };
  }
}
