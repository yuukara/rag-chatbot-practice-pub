import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';

type ChatRequest = {
  message: string;
};

@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('message')
  getMessage(): { message: string } {
    return this.appService.getMessage();
  }

  @Post('chat')
  chat(@Body() body: ChatRequest): Promise<{ message: string }> {
    return this.appService.chat(body.message);
  }
}

