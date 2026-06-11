import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [ChatController],
})
export class ChatModule {}
